/**
 * CODE ANSWERS (Phase 2, owner design 2026-11-03): the learner answers in
 * code. One contract shared by the teaching/probing `code` question tools,
 * the practice `problem` code option, the dock, the runner and the model
 * view. Pure and browser-safe.
 *
 * Owner decisions: languages react | vue | javascript | typescript | html;
 * the tutor defines the files and the learner edits their contents only;
 * the tutor receives files plus run status, console output and errors as
 * TEXT only (provider-neutral, G6); runs happen only in the Phase 1 sandbox.
 */

import { Type, type Static } from "typebox";

export const CODE_LANGUAGES = ["react", "vue", "javascript", "typescript", "html"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const MAX_CODE_FILES = 8;
export const MAX_CODE_FILE_CHARS = 50_000;
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

/** Allowed extensions per language. Files are flat (no folders). */
export const CODE_EXTENSIONS: Record<CodeLanguage, readonly string[]> = {
	react: [".jsx", ".tsx", ".js", ".ts", ".css"],
	vue: [".jsx", ".tsx", ".js", ".ts", ".css"],
	javascript: [".js", ".mjs"],
	typescript: [".ts", ".js"],
	html: [".html", ".css", ".js"],
};

/** The single file a question with no starter files gets. */
export const DEFAULT_CODE_FILE: Record<CodeLanguage, string> = {
	react: "App.jsx",
	vue: "App.jsx",
	javascript: "main.js",
	typescript: "main.ts",
	html: "index.html",
};

export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
	react: "React",
	vue: "Vue",
	javascript: "JavaScript",
	typescript: "TypeScript",
	html: "HTML + CSS",
};

export interface CodeFile {
	name: string;
	content: string;
}

export const codeFileSchema = Type.Object({
	name: Type.String({ description: "Flat file name with extension, e.g. App.jsx, Button.jsx, styles.css, index.html." }),
	content: Type.String({ description: "The starter content the learner sees (may be empty)." }),
});

export const codeLanguageSchema = Type.Union([Type.Literal("react"), Type.Literal("vue"), Type.Literal("javascript"), Type.Literal("typescript"), Type.Literal("html")], {
	description:
		"REQUIRED — bare word: react (JSX/TSX; the entry file's default export is the rendered component), vue (Vue 3 " +
		"with JSX/TSX; same entry rule), javascript or typescript (the first file runs; console output is shown), html " +
		"(index.html is rendered; its linked .css/.js files are inlined).",
});

const filesDescription =
	`Starter files (max ${MAX_CODE_FILES}, flat names). The learner edits their contents only — he cannot add, rename or ` +
	"delete files, so define every file the answer needs. Fence the demand to exactly one step: give him the " +
	"surrounding code and leave the part this step is about for him to write. Omit for one empty file. " +
	"react/vue: the entry is App.jsx/App.tsx if present, otherwise the first file. javascript/typescript: the first file " +
	"runs. html: index.html is the page.";

/** The fields every code question shares (teaching, probing, practice). */
export const codeRequestProperties = {
	language: codeLanguageSchema,
	files: Type.Optional(Type.Array(codeFileSchema, { maxItems: MAX_CODE_FILES, description: filesDescription })),
	run: Type.Boolean({
		description:
			"REQUIRED — true lets the learner run the code in a sandbox (rendered output for react/vue/html, console " +
			"output for javascript/typescript) and you receive the run's status, console output and errors with his " +
			"answer; false when reading the code is enough.",
	}),
};

/** The practice `problem` code option (G3: short, decision-dense). */
export const problemCodeSchema = Type.Object(codeRequestProperties, {
	description:
		"OPTIONAL — make this a code problem: the learner answers by writing code in an editor. Put your solution code " +
		"in modelSolution.",
});
export type ProblemCodeRequest = Static<typeof problemCodeSchema>;

/** A run's evidence, bounded before it is stored or shown to the model. */
export type CodeRunStatus = "ok" | "error" | "compile-error" | "stopped";
export interface CodeRunOutputLine {
	level: "log" | "info" | "warn" | "error";
	text: string;
}
export interface CodeRunResult {
	status: CodeRunStatus;
	output: CodeRunOutputLine[];
	errors: string[];
	/** True when the files changed after this run (the evidence predates the answer). */
	stale?: boolean;
}

export const MAX_RUN_LINES = 200;
export const MAX_RUN_LINE_CHARS = 2_000;
export const MAX_RUN_TOTAL_CHARS = 20_000;
export const MAX_RUN_ERRORS = 20;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [truncated]` : text);

/** Clamp untrusted run evidence (it comes from learner code via the bridge). */
export function boundRunResult(raw: unknown): CodeRunResult | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Partial<CodeRunResult>;
	const statuses: readonly string[] = ["ok", "error", "compile-error", "stopped"];
	if (typeof r.status !== "string" || !statuses.includes(r.status)) return undefined;
	const levels: readonly string[] = ["log", "info", "warn", "error"];
	const output: CodeRunOutputLine[] = [];
	let total = 0;
	for (const line of Array.isArray(r.output) ? r.output : []) {
		if (output.length >= MAX_RUN_LINES || total >= MAX_RUN_TOTAL_CHARS) break;
		if (!line || typeof line !== "object" || typeof line.text !== "string") continue;
		const text = clip(line.text, Math.min(MAX_RUN_LINE_CHARS, MAX_RUN_TOTAL_CHARS - total));
		total += text.length;
		output.push({ level: levels.includes(line.level) ? line.level : "log", text });
	}
	const errors = (Array.isArray(r.errors) ? r.errors : [])
		.filter((e): e is string => typeof e === "string")
		.slice(0, MAX_RUN_ERRORS)
		.map((e) => clip(e, MAX_RUN_LINE_CHARS));
	return { status: r.status as CodeRunStatus, output, errors, ...(r.stale === true ? { stale: true } : {}) };
}

function extensionOf(name: string): string {
	const i = name.lastIndexOf(".");
	return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** Authoring/payload validation shared by the tools and the answer seam. */
export function codeFilesProblems(language: CodeLanguage, files: readonly CodeFile[] | undefined): string[] {
	if (!files) return [];
	const problems: string[] = [];
	if (files.length > MAX_CODE_FILES) problems.push(`files: at most ${MAX_CODE_FILES} files.`);
	const seen = new Set<string>();
	for (const f of files) {
		if (typeof f?.name !== "string" || typeof f?.content !== "string") { problems.push("files: each file needs a name and content."); continue; }
		if (!FILE_NAME.test(f.name)) problems.push(`files: "${f.name}" is not a valid flat file name.`);
		else if (!CODE_EXTENSIONS[language].includes(extensionOf(f.name)))
			problems.push(`files: "${f.name}" — ${language} allows ${CODE_EXTENSIONS[language].join(", ")}.`);
		if (seen.has(f.name.toLowerCase())) problems.push(`files: "${f.name}" appears twice.`);
		seen.add(f.name.toLowerCase());
		if (f.content.length > MAX_CODE_FILE_CHARS) problems.push(`files: "${f.name}" is over ${MAX_CODE_FILE_CHARS} characters.`);
	}
	if (language === "html" && files.length > 0 && !files.some((f) => f.name === "index.html"))
		problems.push("files: an html question needs an index.html.");
	return problems;
}

/** The files the learner starts with (one empty default file when none are given). */
export function starterFiles(language: CodeLanguage, files: readonly CodeFile[] | undefined): CodeFile[] {
	return files && files.length > 0 ? files.map((f) => ({ name: f.name, content: f.content })) : [{ name: DEFAULT_CODE_FILE[language], content: "" }];
}

/** The learner's submitted files must be exactly the question's files (edit-only). */
export function submittedFilesProblems(language: CodeLanguage, starter: readonly CodeFile[], submitted: unknown): string[] {
	if (!Array.isArray(submitted)) return ["files are required."];
	const problems = codeFilesProblems(language, submitted as CodeFile[]);
	const expected = starter.map((f) => f.name).join("\n");
	const actual = (submitted as CodeFile[]).map((f) => f?.name).join("\n");
	if (expected !== actual) problems.push("files must match the question's files (contents only may change).");
	return problems;
}

export function isCodeLanguage(value: unknown): value is CodeLanguage {
	return typeof value === "string" && (CODE_LANGUAGES as readonly string[]).includes(value);
}

/** The model-facing text of a code answer: files then run evidence. */
export function formatCodeForModel(files: readonly CodeFile[], run: CodeRunResult | undefined): string {
	const parts = files.map((f) => `--- ${f.name} ---\n${f.content}`);
	if (!run) parts.push("--- run ---\nnot run");
	else {
		const lines = [`status: ${run.status}${run.stale ? " (this run was before his latest edits)" : ""}`];
		if (run.errors.length) lines.push("errors:", ...run.errors.map((e) => `  ${e}`));
		if (run.output.length) lines.push("console:", ...run.output.map((o) => `  [${o.level}] ${o.text}`));
		parts.push(`--- run ---\n${lines.join("\n")}`);
	}
	return parts.join("\n\n");
}

/** A stable fingerprint of file contents (ties run evidence to a version). */
export function filesFingerprint(files: readonly CodeFile[]): string {
	let h = 5381;
	const text = files.map((f) => `${f.name}\u0000${f.content}`).join("\u0001");
	for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
	return `${files.length}:${text.length}:${h >>> 0}`;
}
