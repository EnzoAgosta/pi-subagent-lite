# Changelog

## 0.2.0

- Added the `/agents` command: a read-only overlay listing every subagent spawned in the current session, with a per-subagent detail view replaying its full thread. Tool output and thinking are collapsed by default (`ctrl+o` / `ctrl+t` to expand); detail views tail-follow while the subagent is running.
- Live streaming in the detail view: the in-progress assistant message renders as it streams — markdown text updates live, collapsed thinking shows a live character count (and streams when expanded), and the footer activity label tracks `thinking…` / `writing…` / `calling <tool>…` states, including during tool-argument streaming.

## 0.1.3

- Added missing `pi` manifest to `package.json` so pi can auto-discover the extension when installed as a package.

## 0.1.2

- Fixed extension not loading in main pi session due to collision with `PI_CODING_AGENT` env var. Now uses `PI_SUBAGENT_LITE_DISABLE` to prevent recursive nesting only in subagent processes.
