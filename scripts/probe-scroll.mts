/**
 * Long-thread scroll probe appended scenario: 60-turn subagent, detail view
 * must render only the tail (follow:end) with the footer visible.
 * Run: node scripts/probe-scroll.mts
 */

import { initTheme } from "@earendil-works/pi-coding-agent";
import { AgentsView } from "../agents-view.ts";
import { subagentRegistry, type SubagentStreamEvent } from "../registry.ts";

initTheme("dark");

const WIDTH = 100;
const ROWS = 30;

const fakeTui = {
	terminal: { rows: ROWS, columns: WIDTH },
	requestRender: () => {},
} as any;

const fakeTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as any;

function feed(record: any, event: SubagentStreamEvent) {
	subagentRegistry.ingest(record, event);
}

const long = subagentRegistry.create("Long running task with many turns", []);
long.startedAt = Date.now() - 90_000;
feed(long, { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Task: Long running task" }], timestamp: Date.now() } as any });
for (let turn = 1; turn <= 60; turn++) {
	feed(long, { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: `tc${turn}`, name: "bash", arguments: { command: `step ${turn}` } }], timestamp: Date.now() } as any });
	feed(long, { type: "message_end", message: { role: "toolResult", toolName: "bash", toolCallId: `tc${turn}`, content: [{ type: "text", text: `output of step ${turn}` }], isError: false, timestamp: Date.now() } as any });
}
feed(long, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } });

const view = new AgentsView(fakeTui, fakeTheme, () => {});
const render = (lines: string[]) => lines.map((line) => line.replace(/\n/g, "")).join("\n");

// List shows only `long`, select it and enter detail.
view.handleInput("\x1b[C");

const out = render(view.render(WIDTH)).split("\n");
console.log("total rendered lines:", out.length, `(rows=${ROWS})`);
console.log("shows latest step 60:", out.some((line) => line.includes("step 60")));
console.log("shows earliest step 1:", out.some((line) => line.includes("step 1 ")));
console.log("footer visible:", out.some((line) => line.includes("ctrl+o tool output")));

// Scroll up one line: step 60 should leave the viewport top... verify scrollBy works.
view.handleInput("\x1b[A");
const out2 = render(view.render(WIDTH)).split("\n");
console.log("after ↑, still shows step 60:", out2.some((line) => line.includes("step 60")));
console.log("after ↑, shows step 59:", out2.some((line) => line.includes("step 59")));
