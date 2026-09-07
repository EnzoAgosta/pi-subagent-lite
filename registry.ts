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
	/** Assembled in-progress assistant message (kept for future live rendering). */
	currentPartial: Message | null;
	/** Populated when status is "error". */
	error?: string;
}

/** One event from a subagent's `pi --mode json` stdout stream. */
export interface SubagentStreamEvent {
	type: string;
	message?: Message;
	assistantMessageEvent?: {
		type: string;
		toolName?: string;
		partial?: Message;
	};
}

const records = new Map<string, SubagentRecord>();
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
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
			record.currentPartial = streamEvent.partial ?? record.currentPartial;
			const activity =
				streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta"
					? "thinking…"
					: streamEvent.type === "text_start" || streamEvent.type === "text_delta"
						? "writing…"
						: streamEvent.type === "toolcall_start"
							? `calling ${streamEvent.toolName ?? "tool"}…`
							: record.activity;
			if (activity !== record.activity) {
				record.activity = activity;
				notify();
			}
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
