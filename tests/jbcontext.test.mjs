import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import jbcontext from "../extensions/jbcontext.ts";

const tip = JSON.stringify({
	hookSpecificOutput: { additionalContext: "Hook fixture tip" },
});

function harness(t, config = {}) {
	const calls = [];
	const spawns = [];
	const handlers = new Map();
	const timers = new Set();
	t.mock.method(childProcess, "spawn", (command, args, options) => {
		spawns.push({ command, args, options });
		if (config.spawnThrows) throw new Error("CLI unavailable");
		const child = new EventEmitter();
		child.unref = () => {};
		if (args[0] === "--version" || config.spawnEmitsError) {
			process.nextTick(() => child.emit("error", new Error("CLI unavailable")));
		}
		return child;
	});
	t.mock.method(childProcess, "execFile", (command, args, options, callback) => {
		const call = { command, args, options };
		calls.push(call);
		const child = { stdin: null };
		const finish = (error, stdout = "") => {
			clearTimeout(timer);
			timers.delete(timer);
			callback(error, stdout);
		};
		// An unclosed input pipe reproduces the CLI's timeout, without waiting 8s.
		const timer = setTimeout(() => finish(new Error("stdin never reached EOF")), 100);
		timers.add(timer);
		if (config.noStdin) {
			process.nextTick(() => finish(new Error("CLI unavailable")));
		} else {
			child.stdin = new EventEmitter();
			child.stdin.end = (payload) => {
				call.payload = payload;
				process.nextTick(() => {
					if (config.stdinError) child.stdin.emit("error", new Error("EPIPE"));
					finish(config.error ?? null, config.stdout ?? tip);
				});
			};
		}
		return child;
	});
	syncBuiltinESMExports();
	t.after(() => {
		for (const timer of timers) clearTimeout(timer);
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	jbcontext({
		registerFlag() {},
		getFlag: () => config.enforce ?? false,
		on: (event, handler) => handlers.set(event, handler),
	});
	const ctx = { cwd: process.cwd() };
	return {
		calls,
		spawns,
		ctx,
		emit: (event, payload = {}) => handlers.get(event)(payload, ctx),
	};
}

function beforeStart() {
	return { systemPromptOptions: { promptGuidelines: [] } };
}

function searchCall(command = "rg hook extensions", toolCallId = "search-1") {
	return { toolName: "bash", input: { command }, toolCallId };
}

test("interactive prompts send JSON and close stdin before injecting the tip", async (t) => {
	const h = harness(t);
	const prompt = "Diagnose lag\nincluding unicode: π";
	await h.emit("input", { source: "interactive", text: prompt });
	assert.equal(h.calls.length, 1);
	assert.equal(typeof h.calls[0].payload, "string", "hook stdin must receive JSON and EOF");
	assert.deepEqual(JSON.parse(h.calls[0].payload), { prompt, cwd: h.ctx.cwd });
	assert.deepEqual(h.calls[0].args, ["hook", "user-prompt-submit"]);
	assert.equal(h.calls[0].command, "jbcontext");
	assert.equal(h.calls[0].options.cwd, h.ctx.cwd);
	assert.equal(h.calls[0].options.timeout, 8_000);
	assert.equal(h.calls[0].options.maxBuffer, 1024 * 1024);

	const event = beforeStart();
	const result = await h.emit("before_agent_start", event);
	assert.deepEqual(JSON.parse(h.calls[1].payload), { cwd: h.ctx.cwd });
	assert.deepEqual(h.calls[1].args, ["hook", "session-start-instruct"]);
	assert.deepEqual(event.systemPromptOptions.promptGuidelines, ["Hook fixture tip"]);
	assert.deepEqual(result.message, {
		customType: "jbcontext-tip", content: "Hook fixture tip", display: false,
	});
	assert.equal(await h.emit("before_agent_start", beforeStart()), undefined);
	assert.equal(h.calls.length, 2);
});

test("subsequent prompts still send their own payloads", async (t) => {
	const h = harness(t);
	for (const prompt of ["first", "second"]) {
		await h.emit("input", { source: "interactive", text: prompt });
		const result = await h.emit("before_agent_start", beforeStart());
		assert.equal(result.message.content, "Hook fixture tip");
	}
	assert.deepEqual(h.calls.map((call) => JSON.parse(call.payload)), [
		{ prompt: "first", cwd: h.ctx.cwd }, { cwd: h.ctx.cwd },
		{ prompt: "second", cwd: h.ctx.cwd },
	]);
});

test("search hooks send the tool payload and append the tip only once", async (t) => {
	const h = harness(t);
	const call = searchCall();
	assert.equal(await h.emit("tool_call", call), undefined);
	assert.deepEqual(h.calls[0].args, ["hook", "pre-tool-use"]);
	assert.deepEqual(JSON.parse(h.calls[0].payload), {
		tool_name: "Bash", tool_input: call.input, cwd: h.ctx.cwd,
	});
	const content = [{ type: "text", text: "Search results" }];
	const result = await h.emit("tool_result", { toolCallId: call.toolCallId, content });
	assert.deepEqual(result.content, [
		...content, { type: "text", text: "\nHook fixture tip" },
	]);
	assert.equal(await h.emit("tool_result", { toolCallId: call.toolCallId, content }), undefined);
});

for (const [name, config] of [
	["empty stdout", { stdout: "  " }],
	["malformed JSON", { stdout: "not JSON" }],
	["missing output schema", { stdout: "{}" }],
	["null response", { stdout: "null" }],
	["invalid tip type", { stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 1 } }) }],
	["nonzero exit", { error: new Error("exit code 1") }],
	["timeout", { error: new Error("ETIMEDOUT") }],
	["stdin write failure", { stdinError: true }],
	["missing stdin", { noStdin: true }],
]) {
	test(`${name} is a silent no-op`, async (t) => {
		const h = harness(t, config);
		await h.emit("input", { source: "interactive", text: "Prompt" });
		const event = beforeStart();
		assert.equal(await h.emit("before_agent_start", event), undefined);
		assert.deepEqual(event.systemPromptOptions.promptGuidelines, []);
		assert.equal(await h.emit("tool_call", searchCall()), undefined);
		assert.equal(await h.emit("tool_result", { toolCallId: "search-1", content: [] }), undefined);
	});
}

test("a deny response blocks the search with the CLI's reason", async (t) => {
	const h = harness(t, { stdout: JSON.stringify({ hookSpecificOutput: {
		permissionDecision: "deny", permissionDecisionReason: "Bootstrap search required",
	} }) });
	assert.deepEqual(await h.emit("tool_call", searchCall()), {
		block: true, reason: "Bootstrap search required",
	});
});

test("a malformed deny reason does not block the tool", async (t) => {
	const h = harness(t, { stdout: JSON.stringify({ hookSpecificOutput: {
		permissionDecision: "deny", permissionDecisionReason: 1,
	} }) });
	assert.equal(await h.emit("tool_call", searchCall()), undefined);
});

test("the ENFORCE flag is forwarded to the CLI", async (t) => {
	const h = harness(t, { enforce: true });
	await h.emit("tool_call", searchCall());
	assert.deepEqual(h.calls[0].args, ["hook", "pre-tool-use", "--mode=ENFORCE"]);
});

test("commands, empty prompts, and non-interactive input skip hooks", async (t) => {
	const h = harness(t);
	for (const event of [
		{ source: "interactive", text: "/settings" },
		{ source: "interactive", text: " " },
		{ source: "extension", text: "Prompt" },
	]) await h.emit("input", event);
	assert.equal(h.calls.length, 0);
	assert.equal(h.spawns.length, 0);
});

test("unrelated tools and non-search commands skip hooks", async (t) => {
	const h = harness(t);
	for (const event of [
		{ ...searchCall(), toolName: "read" },
		searchCall("git status"),
		{ toolName: "bash", input: {}, toolCallId: "other" },
	]) await h.emit("tool_call", event);
	assert.equal(h.calls.length, 0);
});

test("session indexing stays detached", async (t) => {
	const h = harness(t);
	await h.emit("session_start");
	await h.emit("session_shutdown");
	assert.deepEqual(h.spawns.map((spawn) => spawn.args), [
		["--version"], ["index", "--silent"], ["index", "--silent"],
	]);
	assert.deepEqual(h.spawns[1].options, { cwd: h.ctx.cwd, detached: true, stdio: "ignore" });
});

test("indexing handles an asynchronously missing binary without crashing", async (t) => {
	const h = harness(t, { spawnEmitsError: true });
	await h.emit("session_start");
	await h.emit("session_shutdown");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(h.calls.length, 0);
});

test("a failed binary check disables hooks and indexing", async (t) => {
	const h = harness(t, { spawnThrows: true });
	await h.emit("session_start");
	await h.emit("input", { source: "interactive", text: "Prompt" });
	assert.equal(await h.emit("before_agent_start", beforeStart()), undefined);
	await h.emit("session_shutdown");
	assert.equal(h.calls.length, 0);
	assert.equal(h.spawns.length, 1);
});

test("a real subprocess receives the payload and EOF without the 8s delay", { timeout: 3_000 }, async (t) => {
	const realExecFile = childProcess.execFile;
	const h = harness(t);
	const children = [];
	const fixture = `
		let input = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => input += chunk);
		process.stdin.on("end", () => {
			const payload = JSON.parse(input);
			process.stdout.write(JSON.stringify({ hookSpecificOutput: {
				additionalContext: JSON.stringify({ payload, args: process.argv.slice(1) })
			} }));
		});
	`;
	t.mock.method(childProcess, "execFile", (_command, args, options, callback) => {
		const child = realExecFile(process.execPath, ["--input-type=module", "-e", fixture, ...args], options, callback);
		children.push(child);
		return child;
	});
	syncBuiltinESMExports();
	t.after(() => {
		for (const child of children) child.kill();
	});
	const prompt = "Real subprocess regression";
	await h.emit("input", { source: "interactive", text: prompt });
	const result = await h.emit("before_agent_start", beforeStart());
	assert.deepEqual(JSON.parse(result.message.content), {
		payload: { prompt, cwd: h.ctx.cwd }, args: ["hook", "user-prompt-submit"],
	});
});
