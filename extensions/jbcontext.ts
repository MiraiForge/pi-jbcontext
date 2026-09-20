/**
 * pi-jbcontext — mirrors the JetBrains Context (jbcontext) agent hooks for pi.
 *
 * Replicates what `jbcontext setup-agent --hooks` installs for Claude Code,
 * Codex, and Junie:
 *
 *   SessionStart / SessionEnd  -> `jbcontext index --silent` (detached)
 *   session-start-instruct     -> bootstrap-first search tip, once per session
 *   UserPromptSubmit           -> occasional reminder tip on user prompts
 *   PreToolUse (Bash|Grep)     -> occasional reminder when the agent reaches
 *                                 for text search (grep/rg/find via bash)
 *
 * The `jbcontext hook` subcommand remains the brain: it owns the tip wording,
 * throttle state, and REMIND/ENFORCE policy. This extension is only a
 * transport adapter — it shells out, parses the Claude-schema JSON output,
 * and injects through pi's extension events. Empty stdout means "no tip
 * right now" and is a no-op.
 *
 * ENFORCE mode (gate text-search tool calls until a bootstrap semantic
 * search has run): start pi with `--jbcontext-enforce` or set
 * JBCONTEXT_ENFORCE=1.
 */

import { execFile, spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BIN = "jbcontext";
const HOOK_TIMEOUT_MS = 8_000;

/** Matches text-search commands inside a bash tool call. */
const TEXT_SEARCH_RE =
	/(^|[\s|;&(])(grep|egrep|fgrep|rg|ack|ag|find)([\s|;&)]|$)/;

interface HookReply {
	/** Reminder/tip text to surface to the model, if any. */
	context?: string;
	/** ENFORCE-mode denial reason, if the call should be blocked. */
	deny?: string;
}

export default function (pi: ExtensionAPI) {
	let binAvailable: boolean | undefined;
	let sessionTipDone = false;
	let pendingPromptTip: string | null = null;
	const pendingToolTips = new Map<string, string>();

	const enforce = () =>
		process.env.JBCONTEXT_ENFORCE === "1" || pi.getFlag("jbcontext-enforce") === true;

	pi.registerFlag("jbcontext-enforce", {
		description: "Gate text-search bash commands behind a jbcontext bootstrap search",
		type: "boolean",
	});

	function checkBin(): boolean {
		if (binAvailable !== undefined) return binAvailable;
		try {
			const res = spawn(BIN, ["--version"], { stdio: "ignore" });
			res.on("error", () => {});
			binAvailable = true; // optimistic; hooks fail silently if absent
		} catch {
			binAvailable = false;
		}
		return binAvailable;
	}

	/** Fire-and-forget index refresh, mirroring Claude's async session hooks. */
	function indexSilently(cwd: string) {
		if (!checkBin()) return;
		try {
			spawn(BIN, ["index", "--silent"], {
				cwd,
				detached: true,
				stdio: "ignore",
			}).unref();
		} catch {
			// never let indexing break a session
		}
	}

	/**
	 * Run `jbcontext hook <event>` with a Claude-shaped JSON payload on stdin.
	 * Returns the parsed reply, or null on empty output / any failure.
	 */
	function runHook(
		event: string,
		payload: Record<string, unknown>,
		cwd: string,
	): Promise<HookReply | null> {
		if (!checkBin()) return Promise.resolve(null);
		const args = ["hook", event];
		if (enforce()) args.push("--mode=ENFORCE");
		return new Promise((resolve) => {
			execFile(
				BIN,
				args,
				{ cwd, timeout: HOOK_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
				(err, stdout) => {
					if (err || !stdout.trim()) return resolve(null);
					try {
						const parsed = JSON.parse(stdout);
						const out = parsed?.hookSpecificOutput ?? {};
						resolve({
							context:
								typeof out.additionalContext === "string"
									? out.additionalContext
									: undefined,
							deny:
								out.permissionDecision === "deny" &&
								typeof out.permissionDecisionReason === "string"
									? out.permissionDecisionReason
									: undefined,
						});
					} catch {
						resolve(null);
					}
				},
			);
		});
	}

	// --- Session-boundary indexing (SessionStart / SessionEnd) ---------------

	pi.on("session_start", async (_event, ctx) => {
		indexSilently(ctx.cwd);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		indexSilently(ctx.cwd);
	});

	// --- UserPromptSubmit -----------------------------------------------------

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") return; // mirrors UserPromptSubmit
		const text = event.text.trim();
		if (!text || text.startsWith("/")) return; // skip commands
		const reply = await runHook(
			"user-prompt-submit",
			{ prompt: text, cwd: ctx.cwd },
			ctx.cwd,
		);
		if (reply?.context) pendingPromptTip = reply.context;
		// never transform or handle — observation only
	});

	// --- session-start-instruct + prompt tip injection ------------------------

	pi.on("before_agent_start", async (event, ctx) => {
		let message: string | undefined;

		if (!sessionTipDone) {
			sessionTipDone = true;
			const reply = await runHook(
				"session-start-instruct",
				{ cwd: ctx.cwd },
				ctx.cwd,
			);
			if (reply?.context) {
				// Persistent one-time guidance; patched in once via prompt diffing.
				event.systemPromptOptions?.promptGuidelines?.push(reply.context);
			}
		}

		if (pendingPromptTip) {
			message = pendingPromptTip;
			pendingPromptTip = null;
		}

		if (message) {
			return {
				message: {
					customType: "jbcontext-tip",
					content: message,
					display: false,
				},
			};
		}
	});

	// --- PreToolUse (Bash|Grep) -----------------------------------------------

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const command = (event.input as { command?: string }).command ?? "";
		if (!TEXT_SEARCH_RE.test(command)) return;

		const reply = await runHook(
			"pre-tool-use",
			{
				tool_name: "Bash",
				tool_input: { command },
				cwd: ctx.cwd,
			},
			ctx.cwd,
		);
		if (!reply) return;

		if (reply.deny) {
			return { block: true, reason: reply.deny };
		}
		if (reply.context) {
			// tool_call cannot inject context; deliver it via tool_result.
			pendingToolTips.set(event.toolCallId, reply.context);
		}
	});

	pi.on("tool_result", async (event) => {
		const tip = pendingToolTips.get(event.toolCallId);
		if (!tip) return;
		pendingToolTips.delete(event.toolCallId);
		return {
			content: [...event.content, { type: "text" as const, text: `\n${tip}` }],
		};
	});
}
