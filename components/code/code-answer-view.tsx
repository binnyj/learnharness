"use client";

/**
 * A submitted code answer as a record (Phase 2): the files, read-only, and
 * the run summary. Used by the answered card (code / probe_code) and the
 * practice submission card. Learner code renders as text, never as markup.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CodeFile, CodeRunResult } from "@/src/core";

const RUN_LABEL: Record<CodeRunResult["status"], string> = {
	ok: "Ran without errors",
	error: "Runtime error",
	"compile-error": "Didn't compile",
	stopped: "Stopped",
};

export function CodeAnswerView({ files, run }: { files: CodeFile[]; run?: CodeRunResult }) {
	const [active, setActive] = useState(0);
	const [consoleOpen, setConsoleOpen] = useState(false);
	const file = files[active] ?? files[0];
	if (!file) return null;
	const consoleLines = (run?.errors.length ?? 0) + (run?.output.length ?? 0);
	return (
		<div data-testid="code-answer" className="mt-2 overflow-hidden rounded-lg border border-border/70">
			{files.length > 1 && (
				<div role="tablist" aria-label="Submitted files" className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-1">
					{files.map((f, i) => (
						<button
							key={f.name}
							type="button"
							role="tab"
							aria-selected={i === active}
							onClick={() => setActive(i)}
							className={cn("rounded-md px-2 py-0.5 font-mono text-xs", i === active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50")}
						>
							{f.name}
						</button>
					))}
				</div>
			)}
			{files.length === 1 && <div className="border-b border-border/60 px-2.5 py-1 font-mono text-xs text-muted-foreground">{file.name}</div>}
			<pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">{file.content || " "}</pre>
			<div className="flex items-center gap-2 border-t border-border/60 px-2.5 py-1 text-xs">
				<span data-testid="code-answer-run" className={cn("font-medium", run && run.status !== "ok" ? "text-destructive" : "text-muted-foreground")}>
					{run ? RUN_LABEL[run.status] : "Not run"}
				</span>
				{run?.stale && <span className="text-muted-foreground">· run was before the last edits</span>}
				{consoleLines > 0 && (
					<button type="button" onClick={() => setConsoleOpen((v) => !v)} className="ml-auto text-muted-foreground hover:text-foreground">
						{consoleOpen ? "Hide output" : `Output (${consoleLines})`}
					</button>
				)}
			</div>
			{consoleOpen && run && (
				<div className="max-h-40 overflow-auto border-t border-border/60 px-2.5 py-1.5 font-mono text-xs">
					{run.errors.map((e, i) => <pre key={`e${i}`} className="whitespace-pre-wrap text-destructive">{e}</pre>)}
					{run.output.map((o, i) => <pre key={`o${i}`} className={cn("whitespace-pre-wrap", o.level === "error" && "text-destructive")}>{o.text}</pre>)}
				</div>
			)}
		</div>
	);
}
