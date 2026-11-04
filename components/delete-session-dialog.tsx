"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import type { ChatDeleteMode, ChatListItem } from "@/src/core";

/** The graph-traces checkbox copy (owner, 2026-09-24 flow rework — was
 *  the delete-nodes option's body in the two-button design): the
 *  graph-touching consequence says so, shared-topic survival included.
 *  Exported pure for render pins: the copy is design, not implementation. */
export const TRACES_COPY = {
	testid: "delete-traces",
	checkbox: "delete-traces-checkbox",
	title: "Also remove its graph traces",
	body: "This session’s topics, links, and events leave the graph too. Topics other sessions or imported notes also cover survive; topics only this session created are removed entirely.",
};

/**
 * Session deletion (wave 6 chunk A; owner flow rework 2026-09-24) — THE
 * destructive-confirmation surface, portaled z-50 like the setup dialog,
 * now in the node dialog's shape (the two must read as one design):
 *
 *   - red title "Delete session?" in the abort-turn look (owner, 2026-10-13
 *     polish: text-sm font-semibold JetBrains Mono via the UI default —
 *     the serif display title is gone), the session name below it in
 *     JetBrains Mono at normal text-sm size (was sized-up text-lg), no
 *     code-block chrome;
 *   - ONE unchecked-by-default checkbox "Also remove its graph traces"
 *     (unchecked = preserve-graph: the session record, its jobs, and its
 *     extraction bookkeeping die; the graph keeps every contribution.
 *     checked = delete-nodes: the session's ledger traces go too);
 *   - a bottom row Cancel + destructive-red Delete, exactly the node
 *     dialog's pair.
 *
 * Retryable failures render honestly with a Try-again: 409 turn_in_flight /
 * jobs_running ("wait for running work") and 503 extraction_winding_down
 * ("in a moment") both clear on their own — the server's error line is
 * already written for the user; we show it verbatim. Try-again is just
 * Delete pressed again — the mode re-derives from the checkbox.
 */
export function DeleteSessionDialog({
	chat,
	onClose,
	onDeleted,
}: {
	/** The session up for deletion; null = closed. */
	chat: Pick<ChatListItem, "id" | "title"> | null;
	onClose: () => void;
	/** Success path — the sidebar owns navigation + list patching. */
	onDeleted: (id: string, mode: ChatDeleteMode, graphRevision: number) => void;
}) {
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	// Retry IS pressing Delete again: the mode always derives from the
	// checkbox's current state (a toggle between failure and retry is a
	// change of intent, honored as such — the checkbox is disabled while
	// busy, so no mid-flight switches).
	const [failure, setFailure] = useState<{ code: string; error: string } | null>(null);

	// Fresh state per session: closing resets, opening a new chat starts clean.
	useEffect(() => {
		if (!chat) {
			setTraces(false);
			setBusy(false);
			setFailure(null);
		}
	}, [chat]);

	// Esc closes (claimed — a menu/dialog Esc must not also abort a turn).
	useEffect(() => {
		if (!chat) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// THE ONE-ESC LAW (keyboard round 2026-10-06): claim at the
				// document level — a window-level stopPropagation cannot stop
				// the earlier-registered global window listener.
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [chat, onClose]);

	const run = async () => {
		if (!chat || busy) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/chats/${chat.id}?mode=${mode}`, { method: "DELETE" });
			const body = (await res.json()) as {
				ok?: boolean;
				error?: string;
				code?: string;
				graphRevision?: number;
			};
			if (!res.ok) {
				// 409 (turn/jobs running) and 503 (extraction winding down) are
				// both retryable — keep the dialog open, show the server's line.
				setFailure({ code: body.code ?? "error", error: body.error ?? `Delete failed (${res.status})` });
				setBusy(false);
				return;
			}
			onDeleted(chat.id, mode, body.graphRevision ?? 0);
		} catch {
			setFailure({ code: "network", error: "Delete failed — network error. Try again." });
			setBusy(false);
		}
	};

	if (!chat) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			{...backdropDismiss}
		>
			<DeleteSessionBody
				chat={chat}
				traces={traces}
				busy={busy}
				failure={failure}
				onTraces={(next) => setTraces(next)}
				onClose={onClose}
				onRun={() => void run()}
			/>
		</div>,
		document.body,
	);
}

/** The dialog's pure body — exported for SSR pins (the settings-dialog /
 *  node-dialog body pattern). The wrapper owns state + effects + portal. */
export function DeleteSessionBody({
	chat,
	traces,
	busy,
	failure,
	onTraces,
	onClose,
	onRun,
}: {
	chat: Pick<ChatListItem, "id" | "title">;
	/** The graph-traces checkbox — unchecked by default (preserve-graph). */
	traces: boolean;
	busy: boolean;
	failure: { code: string; error: string } | null;
	onTraces: (next: boolean) => void;
	onClose: () => void;
	onRun: () => void;
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete session"
			data-testid="delete-session-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">Delete session?</h2>
			{/* The session name below the title in JetBrains Mono (owner,
			    2026-09-24): no code-block chrome — the font already says
			    code. Owner, 2026-10-13 polish: normal text-sm size (was
			    sized-up text-lg), still white. Same shape as the node
			    dialog. */}
			<div className="mt-1.5">
				<code data-testid="session-name-code" className="font-mono text-sm text-foreground">
					{chat.title}
				</code>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				This permanently removes the session — its messages, background jobs, and extraction records. Everything
				it added to the graph stays unless you check below. This cannot be undone.
			</p>
			<label
				data-testid={TRACES_COPY.testid}
				className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-4 py-3"
			>
				<input
					type="checkbox"
					data-testid={TRACES_COPY.checkbox}
					checked={traces}
					onChange={(e) => onTraces(e.target.checked)}
					disabled={busy}
					className="mt-0.5 size-4 shrink-0 accent-primary"
				/>
				<span className="min-w-0">
					<span className="block text-sm text-foreground">{TRACES_COPY.title}</span>
					<span className="mt-1 block text-xs text-muted-foreground">{TRACES_COPY.body}</span>
				</span>
			</label>
			{failure && (
				<div
					role="alert"
					data-testid="delete-failure"
					className="mt-3 rounded-sm border border-border/60 px-3 py-2 text-xs"
				>
					<span className="text-foreground">{failure.error}</span>
					<button
						type="button"
						data-testid="delete-retry"
						onClick={onRun}
						disabled={busy}
						className="ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			{/* The node dialog's exact bottom row: quiet Cancel, destructive
			    red Delete (border + text, fill on hover — the app's
			    established destructive pair). */}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="delete-confirm"
					onClick={onRun}
					disabled={busy}
					className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
				>
					{busy ? "Deleting…" : "Delete"}
				</button>
			</div>
		</div>
	);
}
// ─── Deleting several sessions (owner, 2026-11-03) ──────────────────────────

export interface BulkDeleteResult {
	deleted: string[];
	/** Refused or failed — the server's own line (running work, extraction). */
	skipped: { id: string; error: string }[];
	/** The newest graph revision reported (0 when nothing was deleted). */
	graphRevision: number;
}

/** Delete one session at a time through the single-session route, so every
 *  server gate (turn/jobs running, extraction winding down) and the graph
 *  cleanup stay exactly as they are. Refusals are skipped, never retried. */
export async function deleteSessionsInOrder(
	ids: readonly string[],
	mode: ChatDeleteMode,
	fetchImpl: typeof fetch = fetch,
): Promise<BulkDeleteResult> {
	const result: BulkDeleteResult = { deleted: [], skipped: [], graphRevision: 0 };
	for (const id of ids) {
		try {
			const res = await fetchImpl(`/api/chats/${encodeURIComponent(id)}?mode=${mode}`, { method: "DELETE" });
			const body = (await res.json().catch(() => ({}))) as { error?: string; graphRevision?: number };
			if (!res.ok) {
				result.skipped.push({ id, error: body.error ?? `Delete failed (${res.status})` });
				continue;
			}
			result.deleted.push(id);
			result.graphRevision = Math.max(result.graphRevision, body.graphRevision ?? 0);
		} catch {
			result.skipped.push({ id, error: "Network error." });
		}
	}
	return result;
}

/** The multi-session confirmation: the single dialog's design for N
 *  sessions, with one traces checkbox for all and a skip report. */
export function DeleteSessionsDialog({
	chats,
	onClose,
	onDeleted,
}: {
	/** The selected sessions; null = closed. */
	chats: Pick<ChatListItem, "id" | "title">[] | null;
	onClose: () => void;
	/** After each run: the sidebar removes these rows and refreshes the graph once. */
	onDeleted: (ids: string[], graphRevision: number) => void;
}) {
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	// What is still to delete: starts as the selection, then the skipped ones.
	const [pending, setPending] = useState<Pick<ChatListItem, "id" | "title">[]>([]);
	const [report, setReport] = useState<{ deleted: number; skipped: { title: string; error: string }[] } | null>(null);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});

	useEffect(() => {
		setPending(chats ?? []);
		setReport(null);
		if (!chats) {
			setTraces(false);
			setBusy(false);
		}
	}, [chats]);

	useEffect(() => {
		if (!chats) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				if (!busy) onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [chats, busy, onClose]);

	const run = async () => {
		if (busy || pending.length === 0) return;
		setBusy(true);
		const titles = new Map(pending.map((c) => [c.id, c.title]));
		const result = await deleteSessionsInOrder(pending.map((c) => c.id), traces ? "delete-nodes" : "preserve-graph");
		setBusy(false);
		if (result.deleted.length > 0) onDeleted(result.deleted, result.graphRevision);
		if (result.skipped.length === 0) {
			onClose();
			return;
		}
		const skippedIds = new Set(result.skipped.map((s) => s.id));
		setPending((prev) => prev.filter((c) => skippedIds.has(c.id)));
		setReport({ deleted: result.deleted.length, skipped: result.skipped.map((s) => ({ title: titles.get(s.id) ?? s.id, error: s.error })) });
	};

	if (!chats) return null;

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<DeleteSessionsBody
				chats={pending}
				traces={traces}
				busy={busy}
				report={report}
				onTraces={setTraces}
				onClose={onClose}
				onRun={() => void run()}
			/>
		</div>,
		document.body,
	);
}

export function DeleteSessionsBody({
	chats,
	traces,
	busy,
	report,
	onTraces,
	onClose,
	onRun,
}: {
	chats: Pick<ChatListItem, "id" | "title">[];
	traces: boolean;
	busy: boolean;
	report: { deleted: number; skipped: { title: string; error: string }[] } | null;
	onTraces: (next: boolean) => void;
	onClose: () => void;
	onRun: () => void;
}) {
	const n = chats.length;
	const noun = n === 1 ? "session" : "sessions";
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`Delete ${n} ${noun}`}
			data-testid="delete-sessions-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">{report ? `${n} ${noun} not deleted` : `Delete ${n} ${noun}?`}</h2>
			<ul data-testid="delete-sessions-list" className="mt-1.5 max-h-40 overflow-y-auto">
				{chats.map((c) => (
					<li key={c.id} className="truncate font-mono text-sm text-foreground">{c.title}</li>
				))}
			</ul>
			{report ? (
				<div role="alert" data-testid="delete-sessions-report" className="mt-3 rounded-sm border border-border/60 px-3 py-2 text-xs">
					<p className="text-foreground">
						{report.deleted > 0 ? `Deleted ${report.deleted}. ` : ""}
						{report.skipped.length} skipped — usually work still running; try again in a moment.
					</p>
					<ul className="mt-1 text-muted-foreground">
						{report.skipped.map((s, i) => (
							<li key={i} className="truncate">{s.title}: {s.error}</li>
						))}
					</ul>
				</div>
			) : (
				<p className="mt-2 text-sm text-muted-foreground">
					This permanently removes these sessions — their messages, background jobs, and extraction records. Everything
					they added to the graph stays unless you check below. This cannot be undone.
				</p>
			)}
			<label data-testid={TRACES_COPY.testid} className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-4 py-3">
				<input
					type="checkbox"
					data-testid={TRACES_COPY.checkbox}
					checked={traces}
					onChange={(e) => onTraces(e.target.checked)}
					disabled={busy}
					className="mt-0.5 size-4 shrink-0 accent-primary"
				/>
				<span className="min-w-0">
					<span className="block text-sm text-foreground">Also remove their graph traces</span>
					<span className="mt-1 block text-xs text-muted-foreground">
						These sessions’ topics, links, and events leave the graph too. Topics other sessions or imported notes also cover survive; topics only these sessions created are removed entirely.
					</span>
				</span>
			</label>
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				>
					{report ? "Close" : "Cancel"}
				</button>
				<button
					type="button"
					data-testid="delete-confirm"
					onClick={onRun}
					disabled={busy || n === 0}
					className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
				>
					{busy ? "Deleting…" : report ? "Try again" : `Delete ${n}`}
				</button>
			</div>
		</div>
	);
}
