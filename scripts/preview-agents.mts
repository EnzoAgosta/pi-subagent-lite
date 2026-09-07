/**
 * Headless smoke test for the /agents view: feeds synthetic stream events
 * into the registry and renders the list + detail views to stdout.
 * Run: npx tsx /tmp/agents-preview.ts
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

// --- Subagent 1: still running, mid-thought ---
const running = subagentRegistry.create(
	"Find all test files in src/ and summarize what they cover",
	["code-review"],
);
feed(running, { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Task: Find all test files in src/ and summarize what they cover" }], timestamp: Date.now() } as any });
feed(running, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "..." } });
feed(running, {
	type: "message_end",
	message: {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "The user wants test coverage info. I should list src/**/*.test.ts files first, then read a couple to see what they assert. Let me start with a find command and go from there." },
			{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "fd -e ts 'test' src/" } },
		],
		timestamp: Date.now(),
	} as any,
});
feed(running, { type: "message_end", message: { role: "toolResult", toolName: "bash", toolCallId: "c1", content: [{ type: "text", text: "src/auth.test.ts\nsrc/registry.test.ts\nsrc/agents-view.test.ts" }], isError: false, timestamp: Date.now() } as any });
feed(running, { type: "message_update", assistantMessageEvent: { type: "toolcall_start", toolName: "read" } });

// --- Subagent 2: completed ---
const done = subagentRegistry.create("Review src/auth.ts for security issues", []);
done.startedAt = Date.now() - 48_000;
feed(done, { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Task: Review src/auth.ts for security issues" }], timestamp: Date.now() - 47_000 } as any });
feed(done, {
	type: "message_end",
	message: {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Check the token validation path first." },
			{ type: "text", text: "## Findings\n\n**1. Token expiry not enforced** (`auth.ts:42`)\n\nThe `validateToken` function checks the signature but never compares `exp` against the current time.\n\n**2. Timing-safe comparison missing**\n\nUse `crypto.timingSafeEqual` for secret comparison." },
			{ type: "toolCall", id: "c2", name: "read", arguments: { path: "src/auth.ts" } },
		],
		timestamp: Date.now() - 40_000,
	} as any,
});
feed(done, { type: "message_end", message: { role: "toolResult", toolName: "read", toolCallId: "c2", content: [{ type: "text", text: "line 1\nline 2\nline 3" }], isError: false, timestamp: Date.now() - 39_000 } as any });
feed(done, {
	type: "message_end",
	message: {
		role: "assistant",
		content: [{ type: "text", text: "Two issues found: missing token expiry enforcement and a non-timing-safe secret comparison. Both are quick fixes." }],
		stopReason: "stop",
		timestamp: Date.now() - 30_000,
	} as any,
});
subagentRegistry.finish(done);

// --- Subagent 3: failed ---
const failed = subagentRegistry.create("Run the broken command", []);
failed.startedAt = Date.now() - 5_000;
subagentRegistry.fail(failed, "Subagent exited with code 1: unknown skill 'nope'");

// --- Render: list ---
const view = new AgentsView(fakeTui, fakeTheme, () => {});
const render = (lines: string[]) => lines.map((line) => line.replace(/\n/g, "")).join("\n");

console.log("╔" + "═".repeat(WIDTH - 2) + "╗");
console.log("║ /agents — LIST VIEW (selected: 0)" + " ".repeat(WIDTH - 36) + "║");
console.log("╚" + "═".repeat(WIDTH - 2) + "╝");
console.log(render(view.render(WIDTH)));

// --- Render: detail of the running subagent ---
console.log("\n" + "╔" + "═".repeat(WIDTH - 2) + "╗");
console.log("║ /agents — DETAIL VIEW (running subagent)" + " ".repeat(WIDTH - 42) + "║");
console.log("╚" + "═".repeat(WIDTH - 2) + "╝");
view.handleInput("[B"); // down to second row (done)
view.handleInput("[B"); // down to third row (failed)
view.handleInput("[A"); // back up to done
view.handleInput("[C"); // right → detail
console.log(render(view.render(WIDTH)));

console.log("\n(ok)");
