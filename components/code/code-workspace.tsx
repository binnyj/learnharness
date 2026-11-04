"use client";

/**
 * THE CODE WORKSPACE (Phase 2, owner design 2026-11-03): file tabs (the
 * tutor's files; contents only), the editor, Run/Stop, the sandboxed
 * preview + console, autosaved drafts and a confirmed reset. Shared by the
 * question dock (code / probe_code) and the practice dock (code problems).
 *
 * Runs use the Phase 1 sandbox: an opaque-origin iframe (allow-scripts
 * only), the demo CSP inside the document, and the app's frame-src 'none'
 * header. Compilation happens on the local server; nothing here evaluates
 * learner code in the app's own context.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	CODE_LANGUAGE_LABELS,
	boundRunResult,
	buildRunDocument,
	filesFingerprint,
	freshRunState,
	reduceRunMessage,
	type CodeFile,
	type CodeLanguage,
	type CodeRunResult,
	type CompiledCode,
	type RunState,
} from "@/src/core";

// CodeMirror only touches the DOM inside the editor's effect, so a plain
// import is server-render safe (the editor mounts after hydration).
import { CodeEditor } from "./code-editor";

export interface CodeWorkspaceState {
	files: CodeFile[];
	/** The last run, flagged stale when the files changed after it. */
	run?: CodeRunResult;
}

const VISIBLE_PREVIEW: Record<CodeLanguage, boolean> = { react: true, vue: true, html: true, javascript: false, typescript: false };

function sameFiles(a: readonly CodeFile[], b: readonly CodeFile[]): boolean {
	return a.length === b.length && a.every((f, i) => f.name === b[i]!.name && f.content === b[i]!.content);
}

export function CodeWorkspace({
	chatId,
	draftKey,
	language,
	starter,
	allowRun,
	onChange,
	onSubmitShortcut,
}: {
	chatId?: string;
	/** The question's tool call id (or the practice problem's). */
	draftKey: string;
	language: CodeLanguage;
	starter: CodeFile[];
	allowRun: boolean;
	onChange: (state: CodeWorkspaceState) => void;
	onSubmitShortcut?: () => void;
}) {
	const [files, setFiles] = useState<CodeFile[]>(starter);
	const [active, setActive] = useState(0);
	const [loaded, setLoaded] = useState(!chatId);
	const [confirmReset, setConfirmReset] = useState(false);
	const [compiling, setCompiling] = useState(false);
	const [run, setRun] = useState<RunState | null>(null);
	const [runPrint, setRunPrint] = useState<string | null>(null);
	const [srcDoc, setSrcDoc] = useState<string | null>(null);
	const [runId, setRunId] = useState(0);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// Restore a saved draft (only if it still matches the question's files).
	useEffect(() => {
		if (!chatId) return;
		let live = true;
		fetch(`/api/chats/${encodeURIComponent(chatId)}/code-drafts?key=${encodeURIComponent(draftKey)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { files?: CodeFile[] | null } | null) => {
				if (!live) return;
				const saved = body?.files;
				if (Array.isArray(saved) && saved.length === starter.length && saved.every((f, i) => f.name === starter[i]!.name)) setFiles(saved);
			})
			.catch(() => {})
			.finally(() => live && setLoaded(true));
		return () => { live = false; };
	}, [chatId, draftKey]);

	// Autosave (debounced): a draft equal to the starter files is cleared.
	useEffect(() => {
		if (!chatId || !loaded) return;
		const url = `/api/chats/${encodeURIComponent(chatId)}/code-drafts?key=${encodeURIComponent(draftKey)}`;
		const timer = setTimeout(() => {
			const init: RequestInit = sameFiles(files, starter)
				? { method: "DELETE" }
				: { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) };
			void fetch(url, init).catch(() => {});
		}, 700);
		return () => clearTimeout(timer);
	}, [chatId, draftKey, files, loaded, starter]);

	// Report the current answer state upward.
	const fingerprint = useMemo(() => filesFingerprint(files), [files]);
	useEffect(() => {
		const result = run ? boundRunResult(run.result) : undefined;
		onChangeRef.current({
			files,
			...(result ? { run: runPrint !== null && runPrint !== fingerprint ? { ...result, stale: true } : result } : {}),
		});
	}, [files, run, runPrint, fingerprint]);

	// The bridge: only this run's iframe may talk to us.
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
			setRun((prev) => (prev ? reduceRunMessage(prev, event.data) : prev));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	const startRun = useCallback(async () => {
		setCompiling(true);
		const print = filesFingerprint(files);
		try {
			const res = await fetch("/api/code/compile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ language, files }),
			});
			const body = (await res.json()) as ({ ok: true } & CompiledCode) | { ok: false; errors: string[] };
			setRunPrint(print);
			if (!body.ok) {
				setSrcDoc(null);
				setRun({ running: false, result: { status: "compile-error", output: [], errors: body.errors } });
				return;
			}
			setRun(freshRunState());
			setSrcDoc(buildRunDocument(body));
			setRunId((n) => n + 1);
		} catch {
			setRun({ running: false, result: { status: "compile-error", output: [], errors: ["Could not reach the local compiler."] } });
		} finally {
			setCompiling(false);
		}
	}, [files, language]);

	const stopRun = () => {
		setSrcDoc(null);
		setRun((prev) => (prev ? { running: false, result: prev.running ? { ...prev.result, status: "stopped" } : prev.result } : prev));
	};

	const reset = () => {
		setFiles(starter);
		setActive(0);
		setConfirmReset(false);
		setSrcDoc(null);
		setRun(null);
		setRunPrint(null);
	};

	const current = files[active] ?? files[0]!;
	const status = compiling ? "Compiling…" : run ? (run.running ? "Running…" : statusLabel(run.result)) : null;
	const stale = run && runPrint !== null && runPrint !== fingerprint;

	return (
		<div data-testid="code-workspace" className="overflow-hidden rounded-[10px] border border-border/70 bg-background/60">
			<div className="flex flex-wrap items-center gap-1 border-b border-border/60 px-2 py-1.5">
				<span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{CODE_LANGUAGE_LABELS[language]}</span>
				<div role="tablist" aria-label="Files" className="flex min-w-0 flex-1 flex-wrap gap-1">
					{files.map((f, i) => (
						<button
							key={f.name}
							type="button"
							role="tab"
							aria-selected={i === active}
							onClick={() => setActive(i)}
							data-testid="code-file-tab"
							className={cn(
								"rounded-md px-2 py-0.5 font-mono text-xs transition-colors",
								i === active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
							)}
						>
							{f.name}
						</button>
					))}
				</div>
				{confirmReset ? (
					<span className="flex items-center gap-1 text-xs">
						Discard your changes?
						<button type="button" onClick={reset} data-testid="code-reset-confirm" className="rounded-md px-1.5 py-0.5 font-medium text-destructive hover:bg-accent">Reset</button>
						<button type="button" onClick={() => setConfirmReset(false)} className="rounded-md px-1.5 py-0.5 hover:bg-accent">Keep</button>
					</span>
				) : (
					<button
						type="button"
						onClick={() => setConfirmReset(true)}
						disabled={sameFiles(files, starter)}
						title="Reset to the starter files"
						data-testid="code-reset"
						className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
					>
						<RotateCcwIcon className="size-3" /> Reset
					</button>
				)}
				{allowRun && (srcDoc ? (
					<button type="button" onClick={stopRun} data-testid="code-stop" className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-accent">
						<SquareIcon className="size-3" /> Stop
					</button>
				) : (
					<button type="button" onClick={() => void startRun()} disabled={compiling} data-testid="code-run" className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-accent disabled:opacity-50">
						<PlayIcon className="size-3" /> Run
					</button>
				))}
			</div>

			<div className="max-h-[45dvh] overflow-auto">
				<CodeEditor
					key={current.name}
					fileName={current.name}
					value={current.content}
					ariaLabel={`Code editor: ${current.name}`}
					onSubmitShortcut={onSubmitShortcut}
					onChange={(content) => setFiles((prev) => prev.map((f) => (f.name === current.name ? { ...f, content } : f)))}
				/>
			</div>

			{allowRun && (run || compiling) && (
				<div className="border-t border-border/60" data-testid="code-run-panel">
					<div className="flex items-center gap-2 px-2.5 py-1 text-xs">
						<span data-testid="code-run-status" className={cn("font-medium", run && !run.running && run.result.status !== "ok" ? "text-destructive" : "text-muted-foreground")}>
							{status}
						</span>
						{stale && <span className="text-muted-foreground">· edited since this run</span>}
					</div>
					{srcDoc && (
						<iframe
							key={runId}
							ref={iframeRef}
							title="Code preview"
							// allow-scripts ONLY — never allow-same-origin: learner code
							// can never touch the app's storage, cookies or DOM.
							sandbox="allow-scripts"
							srcDoc={srcDoc}
							data-testid="code-preview"
							className={cn("w-full border-t border-border/60 bg-white", VISIBLE_PREVIEW[language] ? "h-56" : "h-0")}
						/>
					)}
					{run && (run.result.errors.length > 0 || run.result.output.length > 0) && (
						<div data-testid="code-console" className="max-h-40 overflow-auto border-t border-border/60 px-2.5 py-1.5 font-mono text-xs">
							{run.result.errors.map((e, i) => (
								<pre key={`e${i}`} className="whitespace-pre-wrap text-destructive">{e}</pre>
							))}
							{run.result.output.map((o, i) => (
								<pre key={`o${i}`} className={cn("whitespace-pre-wrap", o.level === "error" ? "text-destructive" : o.level === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
									{o.text}
								</pre>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function statusLabel(result: CodeRunResult): string {
	switch (result.status) {
		case "ok": return "Ran without errors";
		case "error": return "Runtime error";
		case "compile-error": return "Didn't compile";
		case "stopped": return "Stopped";
	}
}
