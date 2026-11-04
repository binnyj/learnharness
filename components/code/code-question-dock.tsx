"use client";

/**
 * The code question's expanded dock form (`code` / `probe_code`, Phase 2).
 * Mirrors the explain form's contract — commit-before-pose, the learner's
 * thinking channel, "I don't know", the reveal on submit — with the code
 * workspace as the answer surface. Enter never submits here: the editor and
 * the thinking field take newlines; ⌘/Ctrl+Enter or the button submits.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { finishDictation, isDictationActive, joinDictation, useDictationTarget } from "@/components/dictation";
import { PathInput } from "@/components/path-input";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import {
	buildAnswer,
	normalizeQuizType,
	starterFiles,
	type CodeToolInput,
	type QuestionAnswerData,
	type QuestionData,
	type Phase3,
} from "@/src/core";
import { CodeWorkspace, type CodeWorkspaceState } from "./code-workspace";

export function CodeQuestionDockForm({
	toolName,
	toolCallId,
	input,
	chatId,
	phase = "probe",
	onSubmit,
	onEscape,
	dictationClaim = true,
	compactionRunning = false,
}: {
	toolName: string;
	toolCallId: string;
	input: CodeToolInput;
	chatId?: string;
	phase?: Phase3;
	onSubmit: (output: QuestionAnswerData) => void;
	onEscape?: () => void;
	dictationClaim?: boolean;
	compactionRunning?: boolean;
}) {
	const starter = useMemo(() => starterFiles(input.language, input.files), [input.language, input.files]);
	const qd = useMemo<QuestionData>(() => ({
		id: toolCallId,
		kind: "code",
		questionType: toolName === "code" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
		question: input.question,
		context: input.details,
		mode: "text",
		options: [],
		// The commitment never renders before submit; it snapshots into the answer.
		committedAnswer: input.solution,
		createdAt: new Date().toISOString(),
	}), [toolCallId, toolName, input]);

	const workspace = useRef<CodeWorkspaceState>({ files: starter });
	const [thinking, setThinking] = useState("");
	const thinkingRef = useRef("");

	useDictationTarget(
		useCallback((t: string) => {
			const v = joinDictation(thinkingRef.current, t);
			thinkingRef.current = v;
			setThinking(v);
		}, []),
		dictationClaim,
	);

	const send = (dontKnow: boolean) => {
		if (compactionRunning) return;
		const go = () => {
			const { files, run } = workspace.current;
			onSubmit(buildAnswer(qd, {
				dontKnow,
				language: input.language,
				...(dontKnow ? {} : { files, ...(run ? { run } : {}) }),
				thinking: thinkingRef.current.trim() || undefined,
			}, toolName));
			// The server clears the draft once the answer is durably saved;
			// a refused submit keeps the learner's code.
		};
		if (!isDictationActive()) go();
		else void finishDictation().then(go);
	};

	const label = toolName === "probe_code" ? "Code probe" : qd.questionType === "predict" ? "Code prediction" : "Code";

	return (
		<div data-testid="code-question-dock">
			<div data-dock-scroll-area="" data-session-find-root="" className="max-h-[var(--dock-max-h,70dvh)] overflow-y-auto px-4 pt-3">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
				<div className="mb-3 font-medium">
					<ToolContentResponse>{qd.question}</ToolContentResponse>
				</div>
				{qd.context && (
					<div className="mb-3 text-sm text-muted-foreground">
						<ToolContentResponse>{qd.context}</ToolContentResponse>
					</div>
				)}
				<div className="pb-3">
					<CodeWorkspace
						chatId={chatId}
						draftKey={toolCallId}
						language={input.language}
						starter={starter}
						allowRun={input.run}
						onChange={(state) => { workspace.current = state; }}
						onSubmitShortcut={() => send(false)}
					/>
				</div>
			</div>
			<form
				className="border-t border-border/60 p-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					send(false);
				}}
			>
				<div data-testid="thinking-field" className="@container rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50">
					<div className="px-2.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Your thinking</div>
					<PathInput
						value={thinking}
						onValueChange={(value) => {
							thinkingRef.current = value;
							setThinking(value);
						}}
						onKeyDown={(e) => {
							if (e.key === "Escape" && onEscape) {
								e.preventDefault();
								e.stopPropagation();
								onEscape();
								return;
							}
							// Code dock chord: Enter is a newline; ⌘/Ctrl+Enter submits.
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								send(false);
							}
						}}
						placeholder="What were you going for? Anything you're unsure about."
						className={cn(
							"field-sizing-content lh-input max-h-32 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground/70",
							phase === "teach" ? "min-h-12" : "min-h-10",
						)}
					/>
					<div className="flex items-center justify-between gap-2 p-1">
						{/* The shortcut hint yields first when the dock is narrow. */}
						<span aria-hidden className="hidden pl-1.5 text-xs text-muted-foreground @md:inline">
							{compactionRunning ? "compacting session…" : "⌘↵ submits · ↵ newline"}
						</span>
						<div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
							<Button
								type="button"
								variant="ghost"
								disabled={compactionRunning}
								onClick={() => send(true)}
								data-testid="code-dont-know"
								className="h-9 rounded-[6px] px-3 text-sm"
							>
								I don&apos;t know
							</Button>
							<Button type="submit" disabled={compactionRunning} data-testid="code-submit" className="h-9 rounded-[6px] px-3.5 text-sm font-medium">
								Submit code
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
