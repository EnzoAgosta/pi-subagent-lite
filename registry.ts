/**
 * In-memory registry of subagents spawned in the current session.
 *
 * Each subagent runs as a `pi --mode json` process; runSubagent forwards every
 * parsed stream event here so the /agents command can render a live, read-only
 * view of what each subagent is doing. Registry state lives for the lifetime
 * of the extension instance (i.e. the current session/thread) — pi reloads
 * extensions on session switch, which resets the registry automatically.
 */

import { randomUUID } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";

export type SubagentStatus = "running" | "done" | "error";

export interface SubagentRecord {
	id: string;
	/** The delegated task text. */
	task: string;
	skills: string[];
	status: SubagentStatus;
	startedAt: number;
	endedAt?: number;
	/** Full message history of the subagent, in arrival order. */
	turns: Message[];
	/** Live one-line activity while streaming ("thinking…", "calling read…"). */
	activity: string | null;
	/** In-progress assistant message, rebuilt from stream deltas for live rendering. */
	currentPartial: Message | null;
	/** Populated when status is "error". */
	error?: string;
}

/** One content block of an assistant message (subset of the pi-ai shapes). */
export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}

/**
 * One event from a subagent's `pi --mode json` stdout stream.
 *
 * JSON mode strips the SDK's cumulative `partial` snapshot from assistant
 * streaming events to keep the stream size linear, so deltas must be assembled
 * client-side (see applyAssistantDelta).
 */
export interface SubagentStreamEvent {
	type: string;
	message?: Message;
	assistantMessageEvent?: {
		type: string;
		/** Content block index; always present on delta events in JSON mode. */
		contentIndex: number;
		delta?: string;
		/** Full accumulated content; present on `text_end` / `thinking_end`. */
		content?: string;
		/** Tool-call id; present on `toolcall_start`. */
		id?: string;
		/** Tool name; present on `toolcall_start`. */
		toolName?: string;
		/** Complete tool call; present on `toolcall_end`. */
		toolCall?: ContentBlock & { type: "toolCall" };
	};
}

const records = new Map<string, SubagentRecord>();
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

const STREAM_NOTIFY_THROTTLE_MS = 100;
let throttledNotifyTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesced registry notification: at most one render kick per throttle window. */
function notifyThrottled(): void {
	if (throttledNotifyTimer !== null) return;
	throttledNotifyTimer = setTimeout(() => {
		throttledNotifyTimer = null;
		notify();
	}, STREAM_NOTIFY_THROTTLE_MS);
}

/**
 * Append one assistant stream event onto the record's in-progress message.
 * JSON mode strips cumulative snapshots, so the partial is rebuilt here:
 * `message_start` provides the skeleton, deltas append at `contentIndex`, and
 * the `*_end` events (which carry full content) correct any drift.
 */
function applyAssistantDelta(
	record: SubagentRecord,
	event: NonNullable<SubagentStreamEvent["assistantMessageEvent"]>,
): void {
	const partial = record.currentPartial;
	if (!partial) return;
	const content = partial.content as ContentBlock[];
	const index = event.contentIndex;
	while (content.length < index) content.push({ type: "text", text: "" });
	const block = content[index];
	switch (event.type) {
		case "text_start":
			content[index] = { type: "text", text: "" };
			break;
		case "text_delta":
			if (block?.type === "text") block.text = (block.text ?? "") + (event.delta ?? "");
			break;
		case "text_end":
			if (block?.type === "text") block.text = event.content ?? block.text ?? "";
			break;
		case "thinking_start":
			content[index] = { type: "thinking", thinking: "" };
			break;
		case "thinking_delta":
			if (block?.type === "thinking") block.thinking = (block.thinking ?? "") + (event.delta ?? "");
			break;
		case "thinking_end":
			if (block?.type === "thinking") block.thinking = event.content ?? block.thinking ?? "";
			break;
		case "toolcall_start":
			content[index] = { type: "toolCall", id: event.id ?? "", name: event.toolName ?? "tool", arguments: {} };
			break;
		case "toolcall_delta":
			// Arguments stream as raw JSON fragments; the complete toolCall arrives
			// on toolcall_end, so leave the named placeholder untouched until then.
			break;
		case "toolcall_end":
			if (event.toolCall) content[index] = event.toolCall;
			break;
	}
}

/** One-line activity label for an assistant stream event. */
function streamActivity(
	record: SubagentRecord,
	event: NonNullable<SubagentStreamEvent["assistantMessageEvent"]>,
): string | null {
	if (event.type === "thinking_start" || event.type === "thinking_delta") return "thinking…";
	if (event.type === "text_start" || event.type === "text_delta") return "writing…";
	if (event.type === "toolcall_start" || event.type === "toolcall_delta") {
		const block = (record.currentPartial?.content as ContentBlock[] | undefined)?.[event.contentIndex];
		const toolName = event.toolName ?? (block?.type === "toolCall" ? block.name : undefined) ?? "tool";
		return `calling ${toolName}…`;
	}
	return record.activity;
}

export const subagentRegistry = {
	create(task: string, skills: string[]): SubagentRecord {
		const record: SubagentRecord = {
			id: randomUUID(),
			task,
			skills,
			status: "running",
			startedAt: Date.now(),
			turns: [],
			activity: null,
			currentPartial: null,
		};
		records.set(record.id, record);
		notify();
		return record;
	},

	/** Fold one stream event into a record. Cheap; called once per stream line. */
	ingest(record: SubagentRecord, event: SubagentStreamEvent): void {
		// Invariant guard: never resurrect streaming state on a settled record.
		if (record.status !== "running") return;
		if (event.type === "message_start" && event.message) {
			// Assistant message_start carries the full skeleton (empty content):
			// the base we append streaming deltas onto.
			if (event.message.role === "assistant") {
				record.currentPartial = structuredClone(event.message);
				notify();
			}
			return;
		}
		if (event.type === "message_end" && event.message) {
			record.turns.push(event.message);
			if (event.message.role === "assistant") {
				record.currentPartial = null;
				record.activity = null;
			}
			notify();
			return;
		}

		if (event.type === "message_update" && event.assistantMessageEvent) {
			const streamEvent = event.assistantMessageEvent;
			applyAssistantDelta(record, streamEvent);
			const activity = streamActivity(record, streamEvent);
			if (activity !== record.activity) {
				record.activity = activity;
				notify();
				return;
			}
			// Delta content changes are frequent; coalesce render kicks.
			notifyThrottled();
		}
	},

	finish(record: SubagentRecord): void {
		record.status = "done";
		record.endedAt = Date.now();
		record.activity = null;
		record.currentPartial = null;
		notify();
	},

	fail(record: SubagentRecord, error: string): void {
		record.status = "error";
		record.error = error;
		record.endedAt = Date.now();
		record.activity = null;
		record.currentPartial = null;
		notify();
	},

	list(): SubagentRecord[] {
		return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
	},

	get(id: string): SubagentRecord | undefined {
		return records.get(id);
	},

	count(): number {
		return records.size;
	},

	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};
