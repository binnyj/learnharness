/**
 * CODE COMPILATION (Phase 2, owner design 2026-11-03): the local server
 * bundles the learner's files with esbuild. Compiling never runs learner
 * code; running happens only in the browser sandbox (demo CSP, opaque
 * origin, frame-src 'none').
 *
 * Boundaries:
 * - Learner files live in a virtual namespace; nothing on disk is readable
 *   except the allowlisted packages (react, react-dom, vue) and their own
 *   internal imports.
 * - Every loop in learner code gets a guard that throws after 1 second, so
 *   a runaway loop stops instead of freezing the tab.
 */

import path from "node:path";
import * as acorn from "acorn";
import type { Plugin } from "esbuild";
import { codeFilesProblems, isCodeLanguage, type CodeFile, type CodeLanguage } from "../core/code-answer.ts";

/** Allowlisted packages resolve from the app's own node_modules. (Not
 *  require.resolve: inside Next's bundled route it is rewritten away.) */
const PACKAGE_ROOT = process.cwd();

/** Bare imports learner code may use (owner decision); react* only in
 *  react questions and vue* only in vue questions. */
export const ALLOWED_IMPORTS = new Set([
	"react",
	"react-dom",
	"react-dom/client",
	"react/jsx-runtime",
	"react/jsx-dev-runtime",
	"vue",
	"vue/jsx-runtime",
	"vue/jsx-dev-runtime",
]);

export const LOOP_LIMIT_MS = 1000;
const LOOP_GUARD_FN = "__lhLoopGuard";
/** Defined once at the top of every bundle / html page. */
export const LOOP_GUARD_PRELUDE =
	`function ${LOOP_GUARD_FN}(t){if(Date.now()-t>${LOOP_LIMIT_MS})throw new RangeError("Loop ran longer than ${LOOP_LIMIT_MS / 1000}s and was stopped (possible infinite loop).")}`;

export type CompileResult =
	| { ok: true; mode: "script"; js: string; css: string }
	| { ok: true; mode: "html"; html: string }
	| { ok: false; errors: string[] };

type AnyNode = acorn.Node & Record<string, unknown>;
const LOOP_TYPES = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

/**
 * Insert loop guards into plain JavaScript (already transformed from
 * TS/JSX). Insertion-only edits, so positions stay valid; an unparsable
 * source is returned unchanged (the runtime error then shows the problem).
 */
export function guardLoops(source: string, sourceType: "module" | "script" = "module"): string {
	let ast: acorn.Node;
	try {
		ast = acorn.parse(source, { ecmaVersion: "latest", sourceType, allowHashBang: true });
	} catch {
		return source;
	}
	const edits: { pos: number; text: string; order: number }[] = [];
	let counter = 0;
	const visit = (node: AnyNode, parent: AnyNode | null, depth: number) => {
		if (LOOP_TYPES.has(node.type)) {
			const n = counter++;
			const v = `__lhT${n}`;
			// A labeled loop is wrapped with its label so `continue label` stays valid.
			const outer = parent && parent.type === "LabeledStatement" ? parent : node;
			edits.push({ pos: outer.start, text: `{const ${v}=Date.now();`, order: depth * 2 });
			edits.push({ pos: outer.end, text: "}", order: -depth * 2 });
			const body = node.body as AnyNode;
			if (body.type === "BlockStatement") edits.push({ pos: body.start + 1, text: `${LOOP_GUARD_FN}(${v});`, order: depth * 2 + 1 });
			else {
				edits.push({ pos: body.start, text: `{${LOOP_GUARD_FN}(${v});`, order: depth * 2 + 1 });
				edits.push({ pos: body.end, text: "}", order: -(depth * 2 + 1) });
			}
		}
		for (const key of Object.keys(node)) {
			const value = node[key];
			if (Array.isArray(value)) {
				for (const child of value) if (child && typeof child === "object" && typeof (child as AnyNode).type === "string") visit(child as AnyNode, node, depth + 1);
			} else if (value && typeof value === "object" && typeof (value as AnyNode).type === "string") visit(value as AnyNode, node, depth + 1);
		}
	};
	visit(ast as AnyNode, null, 0);
	if (edits.length === 0) return source;
	// Apply from the end; at equal positions, outer openings precede inner ones.
	edits.sort((a, b) => b.pos - a.pos || b.order - a.order);
	let out = source;
	for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
	return out;
}

function loaderFor(name: string): "jsx" | "tsx" | "js" | "ts" | "css" {
	const ext = path.extname(name).toLowerCase();
	if (ext === ".jsx") return "jsx";
	if (ext === ".tsx") return "tsx";
	if (ext === ".ts") return "ts";
	if (ext === ".css") return "css";
	return "js";
}

/** The file a react/vue bundle mounts: App.jsx/App.tsx if present, else the first file. */
export function entryFileOf(language: CodeLanguage, files: readonly CodeFile[]): CodeFile | undefined {
	if (language === "react" || language === "vue") {
		return files.find((f) => /^App\.(jsx|tsx|js|ts)$/.test(f.name)) ?? files.find((f) => loaderFor(f.name) !== "css");
	}
	return files.find((f) => loaderFor(f.name) !== "css");
}

function lookupFile(files: readonly CodeFile[], spec: string): CodeFile | undefined {
	const name = spec.replace(/^\.\//, "");
	if (name.includes("/")) return undefined;
	const exact = files.find((f) => f.name === name);
	if (exact) return exact;
	for (const ext of [".jsx", ".tsx", ".js", ".ts", ".mjs"]) {
		const hit = files.find((f) => f.name === `${name}${ext}`);
		if (hit) return hit;
	}
	return undefined;
}

function virtualFiles(language: CodeLanguage, files: readonly CodeFile[], entrySource: string): Plugin {
	const jsxImportSource = language === "vue" ? "vue" : "react";
	return {
		name: "learnharness-virtual-files",
		setup(build) {
			build.onResolve({ filter: /.*/ }, async (args) => {
				// Package-internal imports (inside react/vue) resolve normally,
				// as does our own allowlisted lookup below.
				if (args.namespace === "file" || (args.pluginData as { lhPackage?: boolean } | undefined)?.lhPackage) return undefined;
				if (args.path === "lh:entry") return { path: "lh:entry", namespace: "lh" };
				if (args.path.startsWith("./")) {
					const file = lookupFile(files, args.path);
					if (!file) return { errors: [{ text: `Cannot find "${args.path}" — only the question's files can be imported.` }] };
					return { path: file.name, namespace: "lh" };
				}
				if (ALLOWED_IMPORTS.has(args.path)) {
					// react* only in react questions, vue* only in vue questions.
					const pkg = args.path.startsWith("vue") ? "vue" : "react";
					if (pkg !== language) return { errors: [{ text: `"${args.path}" is not available in a ${language} question.` }] };
					const resolved = await build.resolve(args.path, { kind: args.kind, resolveDir: PACKAGE_ROOT, pluginData: { lhPackage: true } });
					if (resolved.errors.length > 0) return { errors: resolved.errors };
					return { path: resolved.path, namespace: "file" };
				}
				return { errors: [{ text: `Cannot import "${args.path}". Only react, react-dom and vue packages and the question's own files are available (no network).` }] };
			});
			build.onLoad({ filter: /.*/, namespace: "lh" }, async (args) => {
				if (args.path === "lh:entry") return { contents: entrySource, loader: "js", resolveDir: "/" };
				const file = files.find((f) => f.name === args.path)!;
				const loader = loaderFor(file.name);
				if (loader === "css") return { contents: file.content, loader: "css" };
				// Transform TS/JSX first so the loop guard sees plain JavaScript.
				const { transform } = await import("esbuild");
				try {
					const plain = await transform(file.content, {
						loader,
						jsx: "automatic",
						jsxImportSource,
						jsxDev: false,
						sourcefile: file.name,
						format: "esm",
						target: "es2022",
					});
					return { contents: guardLoops(plain.code), loader: "js", resolveDir: "/" };
				} catch (error) {
					// Surface the learner's own file/line, not the entry shim's.
					const errors = (error as { errors?: import("esbuild").PartialMessage[] }).errors;
					return { errors: errors ?? [{ text: error instanceof Error ? error.message : String(error) }] };
				}
			});
		},
	};
}

function entrySourceFor(language: CodeLanguage, entry: CodeFile): string {
	const spec = JSON.stringify(`./${entry.name}`);
	if (language === "react") {
		return `import { createElement } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from ${spec};\ncreateRoot(document.getElementById("root")).render(createElement(App));\n`;
	}
	if (language === "vue") {
		return `import { createApp } from "vue";\nimport App from ${spec};\ncreateApp(App).mount("#root");\n`;
	}
	return `import ${spec};\n`;
}

function formatEsbuildErrors(error: unknown): string[] {
	const errors = (error as { errors?: { text: string; location?: { file?: string; line?: number; column?: number; lineText?: string } | null }[] }).errors;
	if (!Array.isArray(errors) || errors.length === 0) return [error instanceof Error ? error.message : String(error)];
	return errors.slice(0, 20).map((e) => {
		const loc = e.location;
		const file = loc?.file?.replace(/^lh:/, "");
		return loc && file ? `${file}:${loc.line}:${(loc.column ?? 0) + 1} ${e.text}${loc.lineText ? `\n  ${loc.lineText.trim()}` : ""}` : e.text;
	});
}

/** Guard loops in every inline <script> of an html page (src scripts are inlined first). */
function guardInlineScripts(html: string): string {
	return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open: string, body: string, close: string) => {
		const isModule = /type\s*=\s*["']?module/i.test(open);
		return `${open}${guardLoops(body, isModule ? "module" : "script")}${close}`;
	});
}

function compileHtml(files: readonly CodeFile[]): CompileResult {
	const index = files.find((f) => f.name === "index.html");
	if (!index) return { ok: false, errors: ["An html question needs an index.html."] };
	const byName = new Map(files.map((f) => [f.name, f.content]));
	const missing: string[] = [];
	let html = index.content.replace(/<link\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi, (tag, href: string) => {
		if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
		const css = byName.get(href.replace(/^\.\//, ""));
		if (css === undefined) { missing.push(href); return tag; }
		return `<style>\n${css}\n</style>`;
	});
	html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']?([^"'\s>]+)["']?([^>]*)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
		const js = byName.get(src.replace(/^\.\//, ""));
		if (js === undefined) { missing.push(src); return tag; }
		return `<script${before}${after}>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`;
	});
	if (missing.length > 0) return { ok: false, errors: missing.map((m) => `index.html references "${m}", which is not one of the question's files (no network).`) };
	return { ok: true, mode: "html", html: `<script>${LOOP_GUARD_PRELUDE}</script>\n${guardInlineScripts(html)}` };
}

/** Compile a code answer for the sandbox. Never executes learner code. */
export async function compileCode(language: unknown, files: unknown): Promise<CompileResult> {
	if (!isCodeLanguage(language)) return { ok: false, errors: ["Unknown language."] };
	if (!Array.isArray(files) || files.length === 0) return { ok: false, errors: ["No files to compile."] };
	const problems = codeFilesProblems(language, files as CodeFile[]);
	if (problems.length > 0) return { ok: false, errors: problems };
	const list = (files as CodeFile[]).map((f) => ({ name: f.name, content: f.content }));
	if (language === "html") return compileHtml(list);
	const entry = entryFileOf(language, list);
	if (!entry) return { ok: false, errors: ["There is no script file to run."] };
	const { build } = await import("esbuild");
	try {
		const result = await build({
			entryPoints: ["lh:entry"],
			bundle: true,
			write: false,
			outdir: "/lh-out",
			format: "iife",
			platform: "browser",
			target: "es2022",
			// Development builds keep React/Vue warnings (keys, hooks rules) — they teach.
			define: {
				"process.env.NODE_ENV": '"development"',
				__VUE_OPTIONS_API__: "true",
				__VUE_PROD_DEVTOOLS__: "false",
				__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
			},
			logLevel: "silent",
			plugins: [virtualFiles(language, list, entrySourceFor(language, entry))],
		});
		const js = result.outputFiles.filter((f) => f.path.endsWith(".js")).map((f) => f.text).join("\n");
		const css = result.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
		return { ok: true, mode: "script", js: `${LOOP_GUARD_PRELUDE}\n${js}`, css };
	} catch (error) {
		return { ok: false, errors: formatEsbuildErrors(error) };
	}
}
