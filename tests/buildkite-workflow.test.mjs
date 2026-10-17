import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Buildkite retains every supported Node test lane on Janus", () => {
	const pipeline = readFileSync(new URL("../.buildkite/pipeline.yml", import.meta.url), "utf8");
	const jobs = [...pipeline.matchAll(/^\s+command: janus-ci (\S+)$/gm)].map(([, job]) => job);
	assert.deepEqual(jobs.sort(), ["test-node-22", "test-node-22-8", "test-node-24"]);
	assert.equal([...pipeline.matchAll(/^\s+queue: janus-linux$/gm)].length, 3);
	assert.doesNotMatch(pipeline, /^\s+(?:plugins|soft_fail):/m);
});

test("GitHub Actions remains available only as a deliberate rollback", () => {
	const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
	const triggers = workflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1];
	assert.ok(triggers);
	assert.match(triggers, /^  workflow_dispatch:/m);
	assert.doesNotMatch(triggers, /^  (?:push|pull_request|schedule):/m);
	assert.match(workflow, /node: \["22\.8\.0", "22", "24"\]/);
});
