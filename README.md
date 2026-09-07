# @jerryan/pi-subagent-lite

A minimal pi extension that delegates tasks to isolated subagent processes.

## What makes this different?

Most subagent extensions ship with heavy abstractions: agent definition files, configurable models, working-directory overrides, and a kitchen sink of rarely-used parameters. **This one doesn't.**

- **Zero setup**: Install via pi and use it in the next session. No agent directories to manage, no agent definitions to write.
- **Minimal interface**: Only `task` and optional `skills`. We removed `model`, `cwd`, `agent`, and other parameters that add more confusion than value.
- **No agent definitions**: Unlike almost every other subagent tool, we don't use `~/.pi/agent/agents/*.md` or any custom agent discovery. If you need specialization, **reuse your existing pi skills** via the `skills` parameter.
- **One focused system prompt**: Every subagent gets the same lean, task-oriented prompt designed for delegation and clear reporting.
- **Transparent long-task handling**: Tasks longer than 4000 chars are automatically spilled to a temp file so they never hit CLI length limits.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Live progress**: See turn-by-turn updates as the subagent works
- **`/agents` command**: A read-only overlay to watch what every subagent spawned in the current session is doing, with live streaming of in-flight assistant messages (see below)
- **Optional skills**: Preload capabilities via `--skill` flags
- **Auto-spill**: Long tasks (>4000 chars) are automatically written to a temp file to avoid CLI limits
- **Clean result rendering**: Final output is clearly marked with a `✓ --- Result ---` separator
- **No recursive nesting**: When running inside a subagent process, the tool never registers itself, so subagents cannot spawn further subagents

## Installation

```bash
pi install npm:@jerryan/pi-subagent-lite
```

The extension will be available the next time you start a pi session.

To try it without installing permanently:

```bash
pi -e npm:@jerryan/pi-subagent-lite
```

For local development, run inside the repo:

```bash
pi -e .
```

## Usage

Once installed, the `subagent` tool is available:

```
Run a subagent to find all test files in the project
```

With skills:

```
Run a subagent with skills ["code-review"] to review src/auth.ts
```

You can also invoke multiple subagents in parallel by making separate tool calls in the same turn.

## Observing subagents: `/agents`

Run `/agents` at any time — including while the agent is still working — to open a read-only overlay showing every subagent spawned in the current session:

- **List view**: running subagents first (with a live activity line like `thinking…`, `writing…`, `calling read…`), finished ones below (✓ completed, ✗ failed, with duration and error message).
- **Detail view**: enter with `→` or `Enter` to read a subagent's full thread — its task, reasoning, tool calls with arguments, and tool results — rendered like a normal pi transcript. While the subagent is still running, the view tail-follows and streams the in-flight assistant message live: text renders as markdown as it arrives, collapsed thinking shows a live character count (expanding with `ctrl+t` streams the reasoning), and the footer activity label tracks `thinking…` / `writing…` / `calling <tool>…` states.

Keybindings:

| Context | Keys | Action |
|---------|------|--------|
| List | `↑` / `↓` | Move selection |
| List | `→` / `Enter` | Open detail view |
| List | `←` / `Esc` | Close the overlay |
| Detail | `↑` / `↓` | Scroll one line |
| Detail | `PgUp` / `PgDn` | Scroll half a page |
| Detail | `Home` / `End` | Jump to top / bottom |
| Detail | `ctrl+o` | Toggle tool output (collapsed by default) |
| Detail | `ctrl+t` | Toggle thinking blocks (collapsed by default) |
| Detail | `←` / `Esc` | Back to the list |

Notes:

- **Strictly read-only** — you cannot interact with running subagents, only observe. To steer the main agent, close the overlay and type normally.
- **Per-session scope** — the overlay only shows subagents spawned in the current session. Running `/reload`, `/new`, or `/resume` starts fresh, so older subagents are not listed.
- If no subagent has been spawned yet, `/agents` simply says so.

## Tool Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | `string` | Yes | The task to delegate to the subagent |
| `skills` | `string[]` | No | Optional skill paths or names to load via `--skill` |

## Development

This fork adds the `/agents` observer on top of upstream. Layout:

- `index.ts` — tool registration, subagent process lifecycle
- `registry.ts` — in-memory registry of subagent records, fed by each subagent's JSON stream
- `agents-view.ts` — the `/agents` overlay (list + detail views)
- `scripts/preview-agents.mts` — headless render harness: `node scripts/preview-agents.mts`

Typecheck with `npx tsc --noEmit`. Ideas and known gaps live in [ideas.md](ideas.md).

## License

MIT © jerryan (upstream); fork changes MIT as well.
