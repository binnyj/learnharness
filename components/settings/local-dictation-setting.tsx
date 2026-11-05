"use client";

/**
 * Dictation engine + local model (owner, 2026-11-05): Local Whisper (the
 * default — audio never leaves this machine) or Deepgram (cloud, needs a
 * key). The local model downloads only when the learner clicks; the server
 * pins the exact revision and verifies every file's fingerprint.
 */

import { useCallback, useEffect, useState } from "react";
import { SettingsRow } from "@/components/settings/controls";
import { useDictationActive } from "@/components/dictation-state";
import { useDictationLanguage } from "@/components/dictation-preference";
import { cn } from "@/lib/utils";
import type { DictationEngine } from "@/src/core";

type ModelStatus =
	| { state: "missing"; totalBytes: number }
	| { state: "downloading"; receivedBytes: number; totalBytes: number }
	| { state: "ready"; totalBytes: number }
	| { state: "error"; error: string; totalBytes: number };

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

export function DictationEngineSetting() {
	const { engine, saveEngine, saving } = useDictationLanguage();
	const active = useDictationActive();
	const choices: { value: DictationEngine; label: string; hint: string }[] = [
		{ value: "local", label: "Local Whisper", hint: "On this Mac — audio never leaves it" },
		{ value: "deepgram", label: "Deepgram", hint: "Cloud — needs a Deepgram key" },
	];
	const current = engine ?? "local";
	return (
		<SettingsRow label="Engine" hint={choices.find((c) => c.value === current)?.hint} testid="row-dictation-engine" dimmed={active}>
			<div role="radiogroup" aria-label="Dictation engine" className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
				{choices.map((c) => (
					<button
						key={c.value}
						type="button"
						role="radio"
						aria-checked={current === c.value}
						disabled={active || saving || engine === undefined}
						onClick={() => { if (current !== c.value) void saveEngine(c.value); }}
						data-testid={`dictation-engine-${c.value}`}
						className={cn(
							"h-8 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-60",
							current === c.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
						)}
					>
						{c.label}
					</button>
				))}
			</div>
		</SettingsRow>
	);
}

export function LocalModelSetting() {
	const [status, setStatus] = useState<ModelStatus | null>(null);
	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/stt/local/model");
			if (res.ok) setStatus((await res.json()) as ModelStatus);
		} catch { /* keep the last known status */ }
	}, []);
	useEffect(() => { void refresh(); }, [refresh]);
	// Poll while a download runs.
	useEffect(() => {
		if (status?.state !== "downloading") return;
		const timer = setInterval(() => void refresh(), 500);
		return () => clearInterval(timer);
	}, [status?.state, refresh]);

	const download = async () => {
		try {
			const res = await fetch("/api/stt/local/model", { method: "POST" });
			setStatus((await res.json()) as ModelStatus);
		} catch { setStatus((s) => ({ state: "error", error: "Could not reach the local server.", totalBytes: s?.totalBytes ?? 0 })); }
	};

	const hint = status?.state === "ready"
		? "whisper-base.en — fingerprint-verified, runs offline"
		: "English speech model, pinned and fingerprint-checked; downloaded once from Hugging Face";
	return (
		<SettingsRow label="Local model" hint={hint} testid="row-dictation-local-model">
			<div className="flex items-center gap-2 text-xs" data-testid="local-model-status">
				{status === null && <span className="text-muted-foreground">Checking…</span>}
				{status?.state === "ready" && <span className="text-foreground">Ready</span>}
				{status?.state === "downloading" && (
					<span className="tabular-nums text-muted-foreground">
						Downloading… {Math.floor((status.receivedBytes / status.totalBytes) * 100)}%
					</span>
				)}
				{status?.state === "error" && <span role="alert" className="max-w-56 text-destructive">{status.error}</span>}
				{(status?.state === "missing" || status?.state === "error") && (
					<button
						type="button"
						onClick={() => void download()}
						data-testid="local-model-download"
						className="rounded-sm border border-border px-2 py-1 hover:bg-accent"
					>
						{status.state === "error" ? "Try again" : `Download model (${mb(status.totalBytes)})`}
					</button>
				)}
			</div>
		</SettingsRow>
	);
}
