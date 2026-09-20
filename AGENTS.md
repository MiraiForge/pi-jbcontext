# Agent Instructions

## Package Manager
Use `npm` exclusively for the rare operations that need one (publish, pack).
Never add `bun`, `pnpm`, or `yarn` lockfiles or config. This package has **zero
runtime dependencies** — keep it that way. There is no build step; pi loads
TypeScript extensions directly via jiti.

## Tool & Skill Usage
Leverage all available tools, skills, and MCP integrations. Prefer tool-assisted
approaches over manual ones.

## Semantic Code Search (jbcontext)
Use `jbcontext search "<query>"` when locating code by meaning and the relevant
file or symbol is unknown. Start with one focused natural-language query, inspect
the first relevant result, then switch to direct file reads or `rg`. Skip semantic
search for exact-file or exact-symbol lookups, known code paths, git operations,
tests, and builds. (Dogfood this — the repo exists to teach agents exactly this
workflow. Run `jbcontext index` first if the index is missing or stale.)

## The One Rule: Never Break the Host Session — MANDATORY

This extension runs inside the user's pi process with full permissions. Every
external interaction — spawning `jbcontext`, parsing its output, reading flags —
must **fail closed to a silent no-op**. No throw may escape an event handler, and
no hook failure may surface as an agent-visible error.

- Wrap every spawn/parse in error handling; treat empty stdout, non-zero exits,
  timeouts, and malformed JSON identically: do nothing.
- If the `jbcontext` binary is absent, all behavior disables cleanly.
- Hook calls are bounded by `HOOK_TIMEOUT_MS`; never let a hung CLI stall a turn.
- Indexing is always detached and fire-and-forget (`jbcontext index --silent`).

## Never Reimplement jbcontext Logic — MANDATORY

The `jbcontext hook` subcommand is the brain: it owns tip wording, throttle
state, and REMIND/ENFORCE policy. This package is a **transport adapter only**.

- Do not hardcode reminder text; parse `hookSpecificOutput.additionalContext`.
- Do not implement our own throttling, counting, or gating policy.
- Do not call undocumented endpoints or guess hook payloads beyond the
  Claude-schema JSON the CLI already accepts.
- If behavior needs to change, it changes in jbcontext or not at all. When the
  CLI's hook schema evolves, update the adapter and nothing else.

## Test-Driven Development — MANDATORY

**All code must be written test-first. No exceptions.**

### Red-Green-Refactor Cycle
1. **Red:** Write a failing test that describes the desired behavior. Run it.
   Confirm it fails for the right reason.
2. **Green:** Write the minimum code to make the test pass.
3. **Refactor:** Improve structure without changing behavior; tests stay green.

### What "test" means in this repo
- Pure logic (the text-search command matcher, hook-output parsing) is factored
  into importable helpers and tested with `node --test` against fixture payloads
  captured from the real `jbcontext hook` CLI.
- Wiring (event handlers) is verified by smoke tests: `pi -e ./extensions/jbcontext.ts`
  in an indexed repo, asserting that indexing spawns and tips appear.
- **Bug fixes:** write the reproducing test first; add regression edge cases.
- **Never delete a test to make the build pass.** Fix it, or document why it is
  obsolete before removing it.

## Coverage Requirements — MANDATORY

**Every commit must meet >=90% line and branch coverage for the files changed in
that commit**, measured against the diff, not the repository. Error-handling
paths (the fail-closed branches above) count toward the threshold — they are the
feature, not the edge case. Coverage exclusions require an inline justification
comment on the same line.

## Software Engineering Principles — MANDATORY

All code must adhere to **SOLID, DRY, and YAGNI**.

- **Single Responsibility:** the extension stays a single-file adapter until a
  second real concern forces a split. Helpers are extracted for testability, not
  speculation.
- **DRY:** shared hook-invocation logic lives in one helper; event handlers
  contain only event-specific mapping.
- **YAGNI:** no options, flags, or abstractions for hypothetical features. The
  current surface (REMIND hooks + one ENFORCE flag) is the whole product until
  real users ask for more. Refactor toward abstraction only at the third real
  usage (Rule of Three).

## Leave It Better Than You Found It
When running tests, linting, or smoke checks, fix pre-existing issues — don't
ignore or suppress them.

## Dead-Code Policy — MANDATORY

- **Already-dead code** (zero callers — verify with a reference search, not
  intuition) is deleted in the PR that finds it, as its own commit with the
  verification noted in the message.
- **Superseded code** (e.g. an event mapping jbcontext no longer emits) is
  deprecated in a comment first and removed in a follow-up, tracked in a GitHub
  issue so it cannot be silently forgotten.
- Removals ship as their own commits with the deletion rationale.

## Context Window Hygiene
When tool calls return large payloads (>2KB), save results to files instead of
dumping them into the conversation; reference paths.

## Subagent Efficiency Rules — MANDATORY

- Subagents read **only** files explicitly named in their task prompt; no
  repo-wide exploration.
- Large outputs go to disk, not into responses.
- One narrow objective per subagent; the parent provides all needed context.

## Commit & PR Conventions
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, etc.
- Every commit and PR description ends with a `Co-authored-by:` trailer
  identifying the agent that contributed.
- Version bumps follow semver: hook-behavior changes are minor at minimum;
  breaking pi-API requirements are major.

## Respect the Project
Follow existing conventions (single-file extension, tab indentation, zero deps,
no build step). Do not introduce frameworks, test runners beyond `node --test`,
or packaging tooling without asking the user first.

## Releasing

`npm publish` requires the maintainer's interactive login — never attempt it
unattended. The release checklist:

1. Tests and smoke checks pass.
2. `npm version <patch|minor|major>` (creates the tag).
3. Push commits and tags; confirm the GitHub repo is public and green.
4. Hand off to the user for `npm publish` (scoped packages publish with
   `--access public`, already set in `publishConfig`).

## Documentation Hierarchy

1. [AGENTS.md](AGENTS.md) — this file (agent coordination + rules)
2. [README.md](README.md) — user-facing documentation
