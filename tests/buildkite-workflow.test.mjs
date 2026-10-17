import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("Buildkite retains every supported Node test lane on Janus", () => {
	const pipeline = readFileSync(new URL("../.buildkite/pipeline.yml", import.meta.url), "utf8");
	const jobs = [...pipeline.matchAll(/^\s+command: janus-ci (\S+)$/gm)].map(([, job]) => job);
	assert.deepEqual(jobs.sort(), ["test-node-22", "test-node-22-8", "test-node-24"]);
	const steps = pipeline.split(/^  - /m).slice(1);
	assert.equal(steps.length, 3);
	for (const lane of ["test-node-22", "test-node-22-8", "test-node-24"]) {
		const step = steps.find((candidate) => new RegExp(`^    key: ${lane}$`, "m").test(candidate));
		assert.ok(step, `Missing Buildkite step for ${lane}`);
		assert.match(step, new RegExp(`^    command: janus-ci ${lane}$`, "m"));
		assert.match(step, /^    agents:\n      queue: janus-linux$/m);
		assert.match(step, /^    timeout_in_minutes: 360$/m);
	}
	assert.doesNotMatch(pipeline, /^\s+(?:plugins|soft_fail):/m);
});

test("GitHub Actions handles fork PRs and deliberate manual rollback only", () => {
	const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
	const triggers = workflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1];
	assert.ok(triggers);
	assert.match(triggers, /^  workflow_dispatch:/m);
	assert.match(triggers, /^  pull_request:\s*$/m);
	assert.doesNotMatch(triggers, /^  (?:push|pull_request_target|workflow_run|schedule):/m);
	assert.match(workflow, /node: \["22\.8\.0", "22", "24"\]/);
	const condition = workflow.match(/^    if: >-\n((?: {6}.*\n)+)/m)?.[1];
	assert.ok(condition, "The test job must distinguish forks from trusted repository PRs");
	for (const [eventName, headRepo, expected] of [
		["pull_request", { full_name: "contributor/pi-jbcontext" }, true],
		["pull_request", { full_name: "MiraiForge/pi-jbcontext" }, false],
		["pull_request", null, false],
		["pull_request", {}, false],
		["workflow_dispatch", undefined, true],
		["push", undefined, false],
		["pull_request_target", { full_name: "contributor/pi-jbcontext" }, false],
	]) {
		const github = {
			event_name: eventName,
			repository: "MiraiForge/pi-jbcontext",
			event: headRepo === undefined ? {} : { pull_request: { head: { repo: headRepo } } },
		};
		assert.equal(Boolean(runInNewContext(condition, { github }, { timeout: 1000 })), expected,
			`${eventName} from ${headRepo?.full_name ?? "no source repository"}`);
	}
});

test("fork tests use only GitHub-hosted runners and unprivileged pinned actions", () => {
	const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
	assert.match(workflow, /^permissions:\n  contents: read\n\n/m);
	assert.deepEqual([...workflow.matchAll(/^  ([\w-]+):/gm)].map(([, key]) => key),
		["pull_request", "workflow_dispatch", "contents", "test"]);
	assert.match(workflow, /^    runs-on: ubuntu-latest$/m);
	assert.match(workflow, /^    timeout-minutes: 360$/m);
	assert.doesNotMatch(workflow, /\b(?:self-hosted|secrets|id-token|environment|container|services)\b|^[ \t]+(?:permissions|env):/m);
	assert.deepEqual([...workflow.matchAll(/^      - uses: (\S+)/gm)].map(([, action]) => action), [
		"actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
		"actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
	]);
	assert.match(workflow, /uses: actions\/checkout@[^\n]+\n        with:\n          persist-credentials: false\n/);
	assert.match(workflow, /^          node-version: \$\{\{ matrix\.node \}\}$/m);
	assert.deepEqual([...workflow.matchAll(/^      - run: (.*)$/gm)].map(([, command]) => command), ["npm test"]);
});
