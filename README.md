# pi-jbcontext

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that mirrors the
[JetBrains Context](https://www.jetbrains.com/) (`jbcontext`) agent hooks, so pi gets the
same semantic code-search behavior that `jbcontext setup-agent` installs for Claude Code,
OpenAI Codex, and Junie.

## What it does

| jbcontext hook (Claude/Codex/Junie) | pi equivalent (this extension) |
| --- | --- |
| `SessionStart` → `jbcontext index --silent` (async) | `session_start` → detached index refresh |
| `SessionEnd` → `jbcontext index --silent` (async) | `session_shutdown` → detached index refresh |
| `session-start-instruct` tip | injected once per session via `before_agent_start` prompt guidelines |
| `UserPromptSubmit` reminder | `input` event → tip injected into the following turn |
| `PreToolUse` on `Bash\|Grep` reminder | `tool_call` on `bash` commands containing `grep`/`rg`/`find`/`ack`/`ag`, tip appended to the tool result |

The extension does **not** reimplement any logic. It shells out to
`jbcontext hook <event>` — the same internal subcommand the other agents' hooks call —
so the tip wording, the throttle state ("occasional" reminders), and the REMIND/ENFORCE
policy stay identical and pick up JetBrains-side changes for free. Empty hook output is a
no-op, and any CLI failure is silently ignored: jbcontext can never break your session.

The reminder workflow the hooks teach:

1. When the relevant file is unknown, run **one broad** `jbcontext search` first.
2. Read at least one returned file and inspect nearby code locally.
3. If that fails, at most **one narrowed retry** scoped to the best hit's directory
   (`jbcontext search -p <path> ...`). Never a second broad search.

## Prerequisites

- [pi](https://github.com/earendil-works/pi-coding-agent)
- `jbcontext` CLI on `PATH`, logged in (`jbcontext login`), with the project indexed
  (`jbcontext index`). See `jbcontext doctor` for an end-to-end self-test.

## Install

```bash
pi install npm:@miraiforge/pi-jbcontext
```

Or try it without installing:

```bash
pi -e npm:@miraiforge/pi-jbcontext
```

## ENFORCE mode

Default behavior is REMIND: occasional tips. To gate text-search bash commands behind a
bootstrap semantic search (the same as `jbcontext hook --mode=ENFORCE`):

```bash
pi --jbcontext-enforce
# or
JBCONTEXT_ENFORCE=1 pi
```

## What this package deliberately leaves out

- **Skills / instructions / subagents** — install those with the official CLI:
  `jbcontext setup-agent --agent=GENERIC --auto` (instructions + skill files) or point pi at
  the generated skill directory. This package is hooks only.
- **MCP** — pi core intentionally ships without MCP; the CLI-first approach above is the
  idiomatic pi path.

## Development

No build step — pi loads TypeScript extensions directly (jiti).

```bash
git clone https://github.com/MiraiForge/pi-jbcontext
cd pi-jbcontext
npm test                         # dependency-free regression tests and coverage
pi -e ./extensions/jbcontext.ts   # smoke test in any indexed repo
```

Tests use Node's built-in runner and TypeScript stripping (Node 22.8+),
with minimum 90% line and branch coverage enforced.
They verify JSON payload delivery, stdin closure, and silent failure handling,
including a real subprocess that reads its input until EOF. No jbcontext login,
network access, or indexed project is needed for the automated tests.

### CI

Buildkite runs `npm test` on Janus using Node 22.8.0, Node 22, and Node 24.
The reviewed configuration is in `.buildkite/pipeline.yml`; the protected agent
image supplies the tool versions and checks out the exact source under test.
Pull requests test an exact merge of their source and base commits.

The GitHub Actions **Tests** workflow remains available through **Run workflow**
as a manual rollback. Commission and verify all three Buildkite lanes before
merging the migration, then require the Buildkite status on protected branches.
To restore automatic Actions, restore the `push` and `pull_request` triggers in
`.github/workflows/test.yml` and pause the corresponding Buildkite pipeline.

## License

MIT
