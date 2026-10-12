import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
	new URL("../.github/workflows/test.yml", import.meta.url),
	"utf8",
);

test("CI actions are pinned to full commit SHAs", () => {
	const actions = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)];
	assert.ok(actions.length > 0, "the test workflow must include action steps");
	for (const [, action] of actions) {
		assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${action} must be immutable`);
	}
});

test("CI checkout does not persist repository credentials", () => {
	const checkout = workflow.split(/^\s*-\s+/m).find(
		(step) => /^\s*uses:\s*actions\/checkout@/m.test(step),
	);
	assert.ok(checkout, "the test workflow must include a checkout step");
	assert.match(
		checkout,
		/^\s*persist-credentials:\s*false\s*$/m,
		"checkout must explicitly disable credential persistence",
	);
});
