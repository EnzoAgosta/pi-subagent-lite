# ideas.md — future reference for the subagent observer

Collected ideas, known gaps, and findings from reviews. Nothing here is
committed to; it's a pool to draw from when we next touch the extension.
Items are roughly ordered by value-per-effort.

## Registry / data layer

- **JSON-mode streams are delta-only (recorded finding).** The `pi --mode json`
  stream strips the SDK's cumulative `partial` snapshot from assistant events
  (`message_update` carries only `contentIndex` + `delta`; `toolcall_start`
  gains `id`/`toolName`; `text_end`/`thinking_end` carry full content;
  `toolcall_end` carries the complete toolCall). Anything rendering live state
  must assemble the partial itself — see `applyAssistantDelta` in registry.ts.
- **Stream-event coverage gaps in the activity state machine.** The meaningful
  gap (`toolcall_delta` leaving the label at `writing…` instead of
  `calling X…`) is fixed. Remaining gaps are cosmetic: `thinking_end` /
  `text_end` briefly leave a stale label until the next `*_start`; the top-level
  `tool_execution_start` event is unused; `toolcall_start` already covers a
  tool's run time accurately enough.
- **Unbounded `turns` growth.** Records accumulate all messages for the
  session; judged harmless (per-subagent volume is small, and the full
  history is the feature). If it ever matters: stop ingesting
  `message_end` beyond N turns per record rather than truncating.
- **Persist records across session reloads.** Currently the registry is
  per-extension-instance and dies with `/reload`, `/new`, `/resume`.
  Could persist an append-only event log (the exact `ingest()` inputs)
  per session file and rehydrate on extension load. The append-only
  shape maps 1:1 onto a replay log. Adds a persistence question
  (where: session data dir? size caps?) — worth it only if post-reload
  archaeology ever becomes a real need.

## View / interaction

- **List view scrolling.** The list doesn't scroll; with ~12+ subagents
  in one session, rows below the fold (and the hint bar) are unreachable,
  and selection can move into invisible rows. Fix with the same
  slice-by-`scrollTop` treatment as the detail view, windowed around the
  selection. Deliberately deferred — real sessions don't spawn that many.
- **Mouse wheel support.** pi-tui only routes mouse input in
  `--tui-mode fullscreen` (experimental; regular mode never sees mouse
  events). If that mode is ever enabled, `handleMouse` on the overlay
  could map wheel to `scrollView.scrollBy(±3)` and clicks to list
  selection. Up/down keyboard scroll is the fallback and is what we ship.
- **Panel background tint.** A tinted panel interior was considered and
  rejected: `theme.bg()` is prefix + `\x1b[49m`, and interior content
  lines contain `\x1b[0m` resets (markdown, truncate ellipsis) that kill
  the background mid-line. Doing it properly requires re-injecting the
  bg ANSI after every reset. The borderAccent frame alone was judged
  enough.

## View rendering nits (logged, low priority)

- Ragged right edges between block kinds: assistant markdown renders at
  full width while user/thinking/tool content wraps 2–4 columns narrower.
- `recordRow` message counts conflate toolResult messages with messages.
- `toolSummary` is duplicated between `index.ts` (inline update text)
  and `agents-view.ts`; could share one helper from `registry.ts`.
- Detail-view body is rendered 2 columns narrower than the list body
  (ScrollView indent); harmless.

## Packaging (only if ever distributed)

- `package.json` `files` whitelist omits `registry.ts` / `agents-view.ts`
  (would break an npm/git-published package; irrelevant for local-path
  installs).
- `peerDependencies` still list the dead `@mariozechner/*` names; should
  be `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-tui`, plus `typebox` — all `"*"`.
- `index.ts` imports `Type` from `@sinclair/typebox`; pi bundles and
  documents the unscoped `typebox` package. Switch for published
  packages (with a matching local devDep so jiti resolves it).
- `types/*.d.ts` are dead `@mariozechner` shims (nothing imports those
  names anymore; tsc passes without them). Deletable, along with the
  tsconfig include entry.
