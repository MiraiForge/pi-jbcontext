import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { engines } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("the declared Node minimum supports the test command's coverage flags", () => {
	const minimum = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(engines.node);
	assert.ok(minimum, "the Node engine must declare an explicit minimum version");
	const major = Number(minimum[1]);
	const minor = Number(minimum[2] ?? 0);
	assert.ok(
		major > 22 || (major === 22 && minor >= 8),
		"native TypeScript stripping and coverage thresholds require Node 22.8.0 or later",
	);
});
