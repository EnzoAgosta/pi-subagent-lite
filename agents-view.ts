/**
 * Read-only /agents overlay: a list of the subagents spawned in the current
 * session, plus a per-subagent detail view replaying its full message thread.
 *
 * Navigation (deliberately minimal):
 *   list   — up/down select, right/enter open detail, left/Esc close
 *   detail — up/down scroll (line), pageUp/pageDown scroll (half page),
 *            ctrl+o toggle tool output, ctrl+t toggle thinking, left/Esc back
 *
 * The component never mutates registry state; it re-renders from registry
 * notifications while open, so detail views tail-follow a running subagent.
 */

import type { Message } from "@earendil-works/pi-ai";
import {
	Key,
	Markdown,
	ScrollView,
	isKeyRelease,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { subagentRegistry, type SubagentRecord } from "./registry.ts";

interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	arguments?: unknown;
}

function contentBlocks(message: Message): ContentBlock[] {
	if (typeof message.content === "string") {
		return [{ type: "text", text: message.content }];
	}
	return (message.content as ContentBlock[]) ?? [];
}

function textOf(message: Message): string {
	return contentBlocks(message)
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}

function formatDuration(startedAt: number, endedAt?: number): string {
	const seconds = Math.max(0, Math.floor(((endedAt ?? Date.now()) - startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** "read (x2), bash" style summary of the tool calls in an assistant turn. */
function toolSummary(turn: Message): string {
	const counts = new Map<string, number>();
	for (const block of contentBlocks(turn)) {
		if (block.type === "toolCall" && block.name) {
			counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([name, count]) => (count > 1 ? `${name} (x${count})` : name))
		.join(", ");
}

function lastAssistantIndex(record: SubagentRecord): number {
	for (let index = record.turns.length - 1; index >= 0; index--) {
		if (record.turns[index].role === "assistant") return index;
	}
	return -1;
}

/** Index of the most recent user-visible line of activity for the list row. */
function listActivity(record: SubagentRecord, theme: Theme): string | null {
	if (record.status === "error") return null;
	if (record.activity) return theme.fg("accent", record.activity);
	const assistantIndex = lastAssistantIndex(record);
	if (assistantIndex === -1) return theme.fg("dim", "starting…");
	const turn = record.turns[assistantIndex];
	const tools = toolSummary(turn);
	const label = tools || "responded";
	const previewLine = textOf(turn).replace(/\s+/g, " ").trim();
	const preview = previewLine ? ` · ${previewLine}` : "";
	return theme.fg("dim", `Turn ${assistantIndex}: ${label}${preview}`);
}

/**
 * Renders the full message thread of one subagent. Lines are cached between
 * renders; Markdown blocks are kept as long-lived components so their
 * internal per-width caches survive re-renders.
 */
class ThreadView implements Component {
	showTools = false;
	showThinking = false;

	private readonly record: SubagentRecord;
	private readonly theme: Theme;
	private readonly markdownTheme = getMarkdownTheme();
	private readonly markdownBlocks = new Map<string, Markdown>();
	private cachedLines: string[] | undefined;
	private cachedWidth: number | undefined;
	private cachedVersion = "";

	constructor(record: SubagentRecord, theme: Theme) {
		this.record = record;
		this.theme = theme;
	}

	invalidate(): void {
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		const version = `${this.record.turns.length}|${this.record.status}|${this.record.error ?? ""}|${this.showTools}|${this.showThinking}`;
		if (this.cachedLines && this.cachedWidth === width && this.cachedVersion === version) {
			return this.cachedLines;
		}
		this.cachedVersion = version;
		this.cachedWidth = width;
		this.cachedLines = this.buildLines(width);
		return this.cachedLines;
	}

	private buildLines(width: number): string[] {
		const lines: string[] = [];
		for (let turnIndex = 0; turnIndex < this.record.turns.length; turnIndex++) {
			const turn = this.record.turns[turnIndex];
			if (turn.role === "user") {
				lines.push(...this.renderUserTurn(textOf(turn), width));
			} else if (turn.role === "assistant") {
				const blocks = contentBlocks(turn);
				for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
					const block = blocks[blockIndex];
					if (block.type === "thinking") {
						lines.push(...this.renderThinking(block, width));
					} else if (block.type === "text") {
						lines.push(...this.renderAssistantText(`${turnIndex}:${blockIndex}`, block, width));
					} else if (block.type === "toolCall") {
						lines.push(...this.renderToolCall(block, width));
					}
				}
			} else if (turn.role === "toolResult") {
				lines.push(...this.renderToolResult(turn, width));
			}
			lines.push("");
		}
		return lines;
	}

	private renderUserTurn(text: string, width: number): string[] {
		const lines: string[] = [];
		for (const line of wrapTextWithAnsi(text, Math.max(10, width - 4))) {
			lines.push(truncateToWidth(`  ${this.theme.bold(line)}`, width));
		}
		return lines;
	}

	private renderAssistantText(key: string, block: ContentBlock, width: number): string[] {
		const markdown = this.markdownBlocks.get(key) ?? new Markdown(block.text ?? "", 0, 0, this.markdownTheme);
		this.markdownBlocks.set(key, markdown);
		return markdown.render(Math.max(10, width - 2)).map((line) => `  ${line}`);
	}

	private renderThinking(block: ContentBlock, width: number): string[] {
		const thinking = block.thinking ?? "";
		if (!this.showThinking) {
			return [`  ${this.theme.fg("dim", `· thinking (${thinking.length} chars) — ctrl+t to expand`)}`];
		}
		const lines: string[] = [];
		for (const line of wrapTextWithAnsi(thinking, Math.max(10, width - 6))) {
			lines.push(truncateToWidth(`  ┊ ${this.theme.fg("dim", line)}`, width));
		}
		return lines;
	}

	private renderToolCall(block: ContentBlock, width: number): string[] {
		const args = block.arguments === undefined ? "" : JSON.stringify(block.arguments);
		const title = `  ⚙ ${this.theme.fg("accent", block.name ?? "tool")} ${this.theme.fg("dim", args)}`;
		return [truncateToWidth(title, width)];
	}

	private renderToolResult(turn: Message, width: number): string[] {
		const toolName = (turn as { toolName?: string }).toolName ?? "tool";
		const isError = Boolean((turn as { isError?: boolean }).isError);
		const output = textOf(turn);
		const lineCount = output.length === 0 ? 0 : output.split("\n").length;
		if (!this.showTools) {
			const flag = isError ? this.theme.fg("error", " · error") : "";
			return [`  ${this.theme.fg("dim", `↳ ${toolName} · ${lineCount} lines${flag} — ctrl+o to expand`)}`];
		}
		const style = (line: string) => (isError ? this.theme.fg("error", line) : this.theme.fg("dim", line));
		const lines: string[] = [];
		for (const line of wrapTextWithAnsi(output, Math.max(10, width - 6))) {
			lines.push(truncateToWidth(`  ┊ ${style(line)}`, width));
		}
		return lines;
	}
}

export class AgentsView implements Component {
	private mode: "list" | "detail" = "list";
	private selected = 0;
	private detailRecordId: string | null = null;
	private threadView: ThreadView | null = null;
	private scrollView: ScrollView | null = null;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly unsubscribe: () => void;

	constructor(tui: TUI, theme: Theme, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.unsubscribe = subagentRegistry.subscribe(() => {
			this.threadView?.invalidate();
			tui.requestRender();
		});
	}

	invalidate(): void {
		this.threadView?.invalidate();
	}

	/** Must be called before the overlay closes so registry listeners are released. */
	dispose(): void {
		this.unsubscribe();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) {
			if (this.mode === "detail") {
				this.mode = "list";
			} else {
				this.close();
			}
			return;
		}

		if (this.mode === "list") {
			const order = this.selectableOrder();
			if (matchesKey(data, Key.up) && this.selected > 0) {
				this.selected--;
			} else if (matchesKey(data, Key.down) && this.selected < order.length - 1) {
				this.selected++;
			} else if ((matchesKey(data, Key.right) || matchesKey(data, Key.enter)) && order[this.selected]) {
				this.openDetail(order[this.selected].id);
			}
			return;
		}

		// Detail mode.
		if (matchesKey(data, Key.up)) {
			this.scrollView?.scrollBy(-1);
		} else if (matchesKey(data, Key.down)) {
			this.scrollView?.scrollBy(1);
		} else if (matchesKey(data, Key.pageUp)) {
			this.scrollView?.scrollBy(-Math.floor(this.viewportHeight() / 2));
		} else if (matchesKey(data, Key.pageDown)) {
			this.scrollView?.scrollBy(Math.floor(this.viewportHeight() / 2));
		} else if (matchesKey(data, Key.home)) {
			this.scrollView?.scrollToStart();
		} else if (matchesKey(data, Key.end)) {
			this.scrollView?.scrollToEnd();
		} else if (matchesKey(data, Key.ctrl("o"))) {
			if (this.threadView) {
				this.threadView.showTools = !this.threadView.showTools;
				this.threadView.invalidate();
			}
		} else if (matchesKey(data, Key.ctrl("t"))) {
			if (this.threadView) {
				this.threadView.showThinking = !this.threadView.showThinking;
				this.threadView.invalidate();
			}
		}
		// Right arrow inside a detail view does nothing (observe-only).
	}

	render(width: number): string[] {
		return this.mode === "list" ? this.renderList(width) : this.renderDetail(width);
	}

	private close(): void {
		this.dispose();
		this.done();
	}

	/** Active subagents first, then settled ones — matches drawing order. */
	private selectableOrder(): SubagentRecord[] {
		const records = subagentRegistry.list();
		return [
			...records.filter((record) => record.status === "running"),
			...records.filter((record) => record.status !== "running"),
		];
	}

	private openDetail(recordId: string): void {
		const record = subagentRegistry.get(recordId);
		if (!record) return;
		this.detailRecordId = recordId;
		this.threadView = new ThreadView(record, this.theme);
		this.scrollView = new ScrollView(this.threadView, { follow: "end", scrollbar: "auto" });
		this.mode = "detail";
	}

	private renderList(width: number): string[] {
		const order = this.selectableOrder();
		this.selected = Math.min(this.selected, Math.max(0, order.length - 1));
		const running = order.filter((record) => record.status === "running");
		const settled = order.filter((record) => record.status !== "running");

		const lines: string[] = [];
		const runningCount = running.length;
		const settledCount = settled.length;
		lines.push(
			truncateToWidth(
				this.theme.bold(
					`Subagents — ${runningCount} running, ${settledCount} finished`,
				),
				width,
			),
		);
		lines.push("");

		let selectableIndex = 0;
		for (const record of running) {
			lines.push(...this.recordRow(record, selectableIndex === this.selected, width));
			selectableIndex++;
		}
		if (settledCount > 0) {
			if (runningCount > 0) {
				lines.push(truncateToWidth(this.theme.fg("dim", "─".repeat(20)), width));
				lines.push("");
			}
			for (const record of settled) {
				lines.push(...this.recordRow(record, selectableIndex === this.selected, width));
				selectableIndex++;
			}
		}

		lines.push("");
		lines.push(
			truncateToWidth(
				this.theme.fg("dim", "↑/↓ select · →/Enter details · Esc close"),
				width,
			),
		);
		return lines;
	}

	private recordRow(record: SubagentRecord, isSelected: boolean, width: number): string[] {
		const indent = isSelected ? "▸ " : "  ";
		const glyph =
			record.status === "running"
				? this.theme.fg("accent", "●")
				: record.status === "done"
					? this.theme.fg("success", "✓")
					: this.theme.fg("error", "✗");
		const task = isSelected ? this.theme.bold(record.task) : record.task;

		const lines: string[] = [];
		lines.push(truncateToWidth(`${indent}${glyph} ${task.replace(/\s+/g, " ")}`, width));

		const activity = listActivity(record, this.theme);
		if (activity !== null) {
			lines.push(truncateToWidth(`  ${activity}`, width));
		}

		if (record.status === "done" || record.status === "error") {
			const turns = record.turns.filter((turn) => turn.role === "assistant").length;
			let statusLine = `  ${record.turns.filter((turn) => turn.role !== "user").length} messages · ${formatDuration(record.startedAt, record.endedAt)}`;
			if (record.error) {
				statusLine += ` · ${this.theme.fg("error", record.error.replace(/\s+/g, " "))}`;
			}
			lines.push(truncateToWidth(statusLine, width));
		}
		return lines;
	}

	private viewportHeight(): number {
		const overhead = 7; // 3 header + 3 footer + 1 safety margin
		return Math.max(4, this.tui.terminal.rows - overhead);
	}

	private renderDetail(width: number): string[] {
		const record = this.detailRecordId ? subagentRegistry.get(this.detailRecordId) : undefined;
		if (!record || !this.threadView || !this.scrollView) {
			// Record vanished (should not happen); fall back to the list.
			this.mode = "list";
			return this.renderList(width);
		}

		const status =
			record.status === "running"
				? this.theme.fg("accent", "running")
				: record.status === "done"
					? this.theme.fg("success", `done · ${formatDuration(record.startedAt, record.endedAt)}`)
					: this.theme.fg("error", "failed");

		const lines: string[] = [];
		lines.push(truncateToWidth(`  ◀ ${this.theme.bold(record.task.replace(/\s+/g, " "))}  ·  ${status}`, width));
		lines.push(
			truncateToWidth(
				this.theme.fg("dim", "↑/↓ scroll · PgUp/PgDn page · ctrl+o tool output · ctrl+t thinking · ←/Esc back"),
				width,
			),
		);
		lines.push(truncateToWidth(this.theme.fg("dim", "─".repeat(width)), width));

		const viewport = this.viewportHeight();
		const content = this.threadView.render(width - 2);
		this.scrollView.updateLayout(content.length, viewport, () => this.tui.requestRender());
		const body = this.scrollView.render(width - 2);
		for (const line of body) lines.push(`  ${line}`);
		while (lines.length < 3 + viewport) lines.push("");

		lines.push(truncateToWidth(this.theme.fg("dim", "─".repeat(width)), width));
		if (record.status === "running") {
			const activity = record.activity ?? "working…";
			lines.push(truncateToWidth(`  ${this.theme.fg("accent", `● ${activity}`)}`, width));
		} else if (record.status === "done") {
			lines.push(
				truncateToWidth(
					`  ${this.theme.fg("success", `✓ completed · ${formatDuration(record.startedAt, record.endedAt)}`)}`,
					width,
				),
			);
		} else {
			const error = (record.error ?? "unknown error").replace(/\s+/g, " ");
			lines.push(truncateToWidth(`  ${this.theme.fg("error", `✗ ${error}`)}`, width));
		}
		lines.push("");
		return lines;
	}
}
