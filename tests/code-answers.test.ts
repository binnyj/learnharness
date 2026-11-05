/**
 * CODE ANSWERS (Phase 2, owner design 2026-11-03): the contract, the record
 * seams (pending, phases, plan position, answers, practice submissions),
 * the tools, the compiler (allowlist + loop guard), the run document, the
 * draft store, and a real-browser run of hostile code in the sandbox.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-code-answers-"));
process.env.LH_DATA_DIR = path.join(tmp, "data");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const core = await import("../src/core/index.ts");
const {
	boundRunResult, buildAnswer, codeFilesProblems, compactAnswerForModel, formatCodeForModel, starterFiles,
	submittedFilesProblems, toolQuestionKind, QUESTION_TOOLS, parseCodeInput, questionNeedsReveal, buildRunDocument,
	reduceRunMessage, freshRunState, CODE_RUN_MESSAGE, MAX_RUN_LINES, MAX_RUN_TOTAL_CHARS,
	inputAppends, parseChatInput, derivePlanStatusesLh, PRACTICE_PROBLEM_TOOL, phaseAt3Lh,
} = core;
const { DEMO_CSP } = await import("../src/core/demo-security.ts");
const { compileCode, guardLoops } = await import("../src/server/code-compile.ts");
const { teachCodeToolFor, probeCodeTool } = await import("../src/agent/tools.ts");
const { problemTool } = await import("../src/agent/tools/practice.ts");
const { codeDraftStore } = await import("../src/store/code-drafts.ts");

const STAMPS = {
	api: "faux", provider: "test", model: "test-model", stopReason: "toolUse",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
} as const;

type Msg = import("../src/core/native-messages.ts").LhMessage;

function call(name: string, id: string, args: unknown): Msg {
	return { id: `a_${id}`, role: "assistant", content: [{ type: "toolCall", id, name, arguments: args as Record<string, unknown> }], timestamp: 1, ...STAMPS } as Msg & AssistantMessage;
}
function ack(name: string, id: string): Msg {
	return { id: `r_${id}`, role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: "ok" }], details: null, isError: false, timestamp: 2 } as Msg & ToolResultMessage;
}

const reactQuestion = {
	question: "Write the counter's click handler.",
	language: "react" as const,
	run: true,
	files: [
		{ name: "App.jsx", content: "import { useState } from 'react';\nexport default function App() {\n  const [n, setN] = useState(0);\n  return <button>{n}</button>;\n}\n" },
		{ name: "styles.css", content: "button { padding: 4px }" },
	],
	solution: "Add onClick={() => setN(n + 1)} — the updater reads the current count.",
};

describe("code answer contract", () => {
	it("validates file names, extensions, duplicates, sizes and html index", () => {
		assert.deepEqual(codeFilesProblems("react", reactQuestion.files), []);
		assert.match(codeFilesProblems("react", [{ name: "../x.jsx", content: "" }]).join(), /not a valid flat file name/);
		assert.match(codeFilesProblems("javascript", [{ name: "a.jsx", content: "" }]).join(), /javascript allows/);
		assert.match(codeFilesProblems("react", [{ name: "A.jsx", content: "" }, { name: "a.jsx", content: "" }]).join(), /appears twice/);
		assert.match(codeFilesProblems("react", [{ name: "A.jsx", content: "x".repeat(50_001) }]).join(), /over 50000/);
		assert.match(codeFilesProblems("html", [{ name: "a.css", content: "" }]).join(), /needs an index.html/);
		assert.deepEqual(starterFiles("vue", undefined), [{ name: "App.jsx", content: "" }]);
	});

	it("submissions must keep exactly the question's files", () => {
		const starter = starterFiles("react", reactQuestion.files);
		assert.deepEqual(submittedFilesProblems("react", starter, starter.map((f) => ({ ...f, content: "edited" }))), []);
		assert.match(submittedFilesProblems("react", starter, [starter[0]]).join(), /must match/);
		assert.match(submittedFilesProblems("react", starter, [...starter, { name: "extra.js", content: "" }]).join(), /must match/);
	});

	it("bounds untrusted run evidence", () => {
		const many = Array.from({ length: 500 }, (_, i) => ({ level: "log", text: `line ${i} ${"x".repeat(100)}` }));
		const r = boundRunResult({ status: "ok", output: many, errors: Array(50).fill("e"), stale: true })!;
		assert(r.output.length <= MAX_RUN_LINES);
		assert(r.output.reduce((n, o) => n + o.text.length, 0) <= MAX_RUN_TOTAL_CHARS + 20);
		assert.equal(r.errors.length, 20);
		assert.equal(r.stale, true);
		assert.equal(boundRunResult({ status: "hacked", output: [], errors: [] }), undefined);
		assert.equal(boundRunResult({ status: "ok", output: [{ level: "evil", text: "t" }], errors: [] })!.output[0]!.level, "log");
	});

	it("formats files and run evidence for the model as text", () => {
		const text = formatCodeForModel([{ name: "App.jsx", content: "x" }], { status: "error", output: [{ level: "warn", text: "careful" }], errors: ["TypeError: boom"], stale: true });
		assert.match(text, /--- App\.jsx ---\nx/);
		assert.match(text, /status: error \(this run was before his latest edits\)/);
		assert.match(text, /TypeError: boom/);
		assert.match(text, /\[warn\] careful/);
		assert.match(formatCodeForModel([{ name: "m.js", content: "" }], undefined), /not run/);
	});
});

describe("code questions through the record seams", () => {
	it("are question tools of kind code, parse for display, and obey the reveal law", () => {
		assert(QUESTION_TOOLS.includes("code") && QUESTION_TOOLS.includes("probe_code"));
		assert.equal(toolQuestionKind("code"), "code");
		assert.equal(toolQuestionKind("probe_code"), "code");
		assert.equal(parseCodeInput({ ...reactQuestion, type: "check", nodeId: "n1" })?.language, "react");
		assert.equal(parseCodeInput({ ...reactQuestion, solution: "  " }), undefined, "the commitment is required");
		assert.equal(questionNeedsReveal("code", { type: "check" }, "teach"), true);
		assert.equal(questionNeedsReveal("code", { type: "predict" }, "teach"), false);
		assert.equal(questionNeedsReveal("probe_code", {}, "probe"), false);
	});

	it("build answers with files, run and the commitment; the model sees code as text", () => {
		const qd = { id: "c1", kind: "code" as const, question: "q", mode: "text" as const, options: [], committedAnswer: "sol", createdAt: "" };
		const files = [{ name: "App.jsx", content: "export default () => <p/>" }];
		const run = { status: "ok" as const, output: [{ level: "log" as const, text: "hi" }], errors: [] };
		const answer = buildAnswer(qd, { files, run, language: "react", thinking: "used the updater" }, "code");
		assert.equal(answer.committed, "sol");
		assert.deepEqual(answer.files, files);
		const model = compactAnswerForModel(answer);
		assert.match(String(model.code), /--- App\.jsx ---/);
		assert.equal(model.thinking, "used the updater");
		const idk = buildAnswer(qd, { dontKnow: true, files, language: "react" }, "code");
		assert.equal(idk.files, undefined, "I don't know sends no files");
	});

	it("a teaching code question moves the plan position and starts the teach phase", () => {
		const tree = { nodes: [{ id: "n1", label: "Hooks" }, { id: "n2", label: "Effects" }], edges: [] } as never;
		const messages = [call("code", "c1", { ...reactQuestion, type: "check", nodeId: "n2" })];
		assert.equal(derivePlanStatusesLh(tree, messages).current, "n2");
	});

	it("validates answers against the question's files and re-bounds the run on the server", () => {
		const record = { messages: [call("code", "c1", { ...reactQuestion, type: "check", nodeId: "n1" })] };
		const files = reactQuestion.files.map((f) => ({ ...f }));
		const good = { kind: "code", questionText: "q", dontKnow: false, answers: [], answeredAt: "t", files, run: { status: "ok", output: Array(400).fill({ level: "log", text: "x" }), errors: [] } };
		const [result] = inputAppends(record, { type: "answer", toolCallId: "c1", answer: good as never });
		const details = (result as ToolResultMessage).details as { files: unknown[]; run: { output: unknown[] }; language: string };
		assert.equal(details.files.length, 2);
		assert(details.run.output.length <= MAX_RUN_LINES);
		assert.equal(details.language, "react");
		assert.throws(() => inputAppends(record, { type: "answer", toolCallId: "c1", answer: { ...good, files: [files[0]] } as never }), /must match/);
		assert.throws(() => inputAppends(record, { type: "answer", toolCallId: "c1", answer: { ...good, kind: "explain" } as never }), /does not match/);
	});

	it("practice code submissions become 'Your code' messages; non-code problems refuse them", () => {
		const codeProblem = [call(PRACTICE_PROBLEM_TOOL, "p1", { statement: "s", mode: "recall", modelSolution: "m", code: { language: "javascript", run: true, files: [{ name: "main.js", content: "" }] } }), ack(PRACTICE_PROBLEM_TOOL, "p1")];
		const input = parseChatInput({ type: "code", problemCallId: "p1", files: [{ name: "main.js", content: "console.log(1)" }], run: { status: "ok", output: [{ level: "log", text: "1" }], errors: [] }, text: "first try" });
		const [marker] = inputAppends({ messages: codeProblem, kind: "practice" }, input);
		const m = marker as { customType: string; content: string; details: { code: { files: unknown[] } } };
		assert.equal(m.customType, "practice-thinking");
		assert.match(m.content, /^Your code:\n--- main\.js ---\nconsole\.log\(1\)/);
		assert.match(m.content, /Your thinking:\nfirst try$/);
		assert.equal(m.details.code.files.length, 1);
		assert.throws(() => inputAppends({ messages: codeProblem }, parseChatInput({ type: "code", problemCallId: "p1", files: [{ name: "other.js", content: "" }] })), /must match/);
		const plain = [call(PRACTICE_PROBLEM_TOOL, "p2", { statement: "s", mode: "recall", modelSolution: "m" }), ack(PRACTICE_PROBLEM_TOOL, "p2")];
		assert.throws(() => inputAppends({ messages: plain }, parseChatInput({ type: "code", problemCallId: "p2", files: [] })), /not a code problem/);
		assert.throws(() => parseChatInput({ type: "code", problemCallId: "p1", files: [], run: { status: "evil" } }), /malformed/);
	});

	it("keeps the probe phase until probe_done, even with code probes", () => {
		assert.equal(phaseAt3Lh([call("probe_code", "x", reactQuestion)]), "probe");
	});
});

describe("code tools", () => {
	const chatStore = { getChat: () => ({ messages: [], tree: { nodes: [{ id: "n1" }] } }) } as never;
	it("the teaching tool validates nodeId, the commitment and files", async () => {
		const tool = teachCodeToolFor({ chatId: "c", chatStore });
		const ok = await tool.execute("t1", { ...reactQuestion, type: "check", nodeId: "n1" });
		assert.notEqual((ok as { isError?: boolean }).isError, true);
		const bad = await tool.execute("t2", { ...reactQuestion, type: "check", nodeId: "nope", files: [{ name: "x.py", content: "" }] });
		assert.match(JSON.stringify(bad), /nodeId \\"nope\\"/);
		assert.match(JSON.stringify(bad), /react allows/);
	});
	it("the probe tool has no nodeId and rejects an empty commitment", async () => {
		const res = await probeCodeTool.execute("t3", { ...reactQuestion, solution: "" });
		assert.match(JSON.stringify(res), /solution is required/);
	});
	it("problem rejects invalid code files", async () => {
		const tool = problemTool({ problemActive: false });
		const res = await tool.execute("t4", { statement: "s", mode: "recall", modelSolution: "m", code: { language: "html", run: true, files: [{ name: "a.css", content: "" }] } });
		assert.match(JSON.stringify(res), /needs an index.html/);
	});
});

describe("compiler", () => {
	it("bundles React, Vue, TypeScript and HTML", async () => {
		const react = await compileCode("react", [{ name: "App.jsx", content: "import './s.css';\nimport B from './B';\nexport default () => <B/>" }, { name: "B.jsx", content: "export default () => <b>hi</b>" }, { name: "s.css", content: "b{color:red}" }]);
		assert(react.ok && react.mode === "script" && react.js.includes("createRoot") && react.css.includes("color: red"));
		const vue = await compileCode("vue", [{ name: "App.tsx", content: "import { ref, defineComponent } from 'vue';\nexport default defineComponent(() => { const n = ref<number>(0); return () => <p>{n.value}</p>; });" }]);
		assert(vue.ok && vue.mode === "script" && vue.js.includes("createApp"));
		const ts = await compileCode("typescript", [{ name: "main.ts", content: "const x: number = 2; console.log(x * 2);" }]);
		assert(ts.ok && ts.mode === "script");
		const html = await compileCode("html", [{ name: "index.html", content: "<link rel=stylesheet href=s.css><script src=a.js></script>" }, { name: "s.css", content: "p{}" }, { name: "a.js", content: "for(;;){}" }]);
		assert(html.ok && html.mode === "html" && html.html.includes("<style>") && html.html.includes("__lhLoopGuard"));
	});

	it("refuses everything outside the question's files and the allowlist", async () => {
		for (const [lang, src, pattern] of [
			["react", "import fs from 'fs'; export default () => null", /Cannot import "fs"/],
			["react", "import x from '../../etc/passwd'; export default () => null", /Cannot import/],
			["react", "import x from '/etc/passwd'; export default () => null", /Cannot import/],
			["react", "import x from './Missing'; export default () => null", /Cannot find/],
			["react", "import { ref } from 'vue'; export default () => null", /not available in a react question/],
			["javascript", "import React from 'react';", /not available in a javascript question/],
		] as const) {
			const r = await compileCode(lang, [{ name: lang === "javascript" ? "main.js" : "App.jsx", content: src }]);
			assert(!r.ok, `${src} should fail`);
			assert.match(r.errors.join("\n"), pattern);
		}
		const missing = await compileCode("html", [{ name: "index.html", content: "<script src=https://evil.example/x.js></script>" }]);
		assert(!missing.ok && /no network/.test(missing.errors.join()));
		const syntax = await compileCode("react", [{ name: "App.jsx", content: "export default function App( {" }]);
		assert(!syntax.ok && /^App\.jsx:1:/.test(syntax.errors[0]!), syntax.ok ? "" : syntax.errors[0]);
	});

	it("loop guards stop runaway loops and keep labeled loops valid", () => {
		const prelude = 'function __lhLoopGuard(t){if(Date.now()-t>1000)throw new RangeError("Loop ran longer than 1s")}';
		const started = Date.now();
		assert.throws(() => vm.runInNewContext(`${prelude}\n${guardLoops("while (true) {}", "script")}`, {}), /longer than 1s/);
		assert(Date.now() - started < 3000);
		const labeled = guardLoops("let n=0; outer: for (let i=0;i<3;i++) { for (let j=0;j<3;j++) { if (j===1) continue outer; n++; } } result = n;", "script");
		const ctx: { result?: number } = {};
		vm.runInNewContext(`${prelude}\n${labeled}`, ctx);
		assert.equal(ctx.result, 3);
		assert.equal(guardLoops("this is not js {", "script"), "this is not js {");
	});
});

describe("run document", () => {
	it("carries the demo CSP and the bridge, and escapes closing script tags", () => {
		const doc = buildRunDocument({ mode: "script", js: "const s = '</script><img src=x>';", css: "" });
		assert(doc.includes(`content="${DEMO_CSP}"`));
		assert(doc.indexOf("Content-Security-Policy") < doc.indexOf("const s"));
		assert(!doc.includes("'</script><img"), "closing tag escaped");
	});
	it("folds only tagged bridge messages, bounded", () => {
		let s = freshRunState();
		s = reduceRunMessage(s, { kind: "console", level: "log", text: "untagged" });
		assert.equal(s.result.output.length, 0);
		s = reduceRunMessage(s, { lh: CODE_RUN_MESSAGE, kind: "console", level: "warn", text: "w" });
		s = reduceRunMessage(s, { lh: CODE_RUN_MESSAGE, kind: "error", text: "boom" });
		s = reduceRunMessage(s, { lh: CODE_RUN_MESSAGE, kind: "done" });
		assert.equal(s.running, false);
		assert.equal(s.result.status, "error");
		assert.deepEqual(s.result.errors, ["boom"]);
	});
});

describe("draft store", () => {
	it("saves, restores, clears, and deletes with the chat", () => {
		const files = [{ name: "App.jsx", content: "draft" }];
		codeDraftStore.saveDraft("chat1", "call_1", files);
		assert.deepEqual(codeDraftStore.getDraft("chat1", "call_1"), files);
		codeDraftStore.clearDraft("chat1", "call_1");
		assert.equal(codeDraftStore.getDraft("chat1", "call_1"), null);
		codeDraftStore.saveDraft("chat1", "call_2", files);
		codeDraftStore.deleteChatDrafts("chat1");
		assert.equal(codeDraftStore.getDraft("chat1", "call_2"), null);
		assert.throws(() => codeDraftStore.saveDraft("../x", "k", files));
		assert.throws(() => codeDraftStore.saveDraft("chat1", "k", [{ name: "a", content: "x".repeat(50_001) }]));
		assert.equal(fs.statSync(process.env.LH_DATA_DIR!).isDirectory(), true);
	});
});

describe("real browser: hostile code in the code sandbox", () => {
	it("cannot reach localhost or navigate, and a runaway loop is stopped without freezing the page", { timeout: 120_000 }, async (t) => {
		const { resolveChromeExecutablePath } = await import("../src/agent/subagents/headless.ts");
		const chrome = resolveChromeExecutablePath();
		if (!chrome) return t.skip("Chrome is not installed");
		const http = await import("node:http");
		const puppeteer = (await import("puppeteer-core")).default;
		const hits: string[] = [];
		const victim = http.createServer((req, res) => { hits.push(req.url ?? ""); res.end("<script>fetch('/after-navigation')</script>"); }).listen(0, "127.0.0.1");
		await new Promise((r) => victim.once("listening", r));
		const port = (victim.address() as { port: number }).port;
		// Blocking a self-navigation replaces the frame, so network/navigation
		// and the runaway loop run as two separate programs.
		const escape = await compileCode("javascript", [{ name: "main.js", content: `fetch("http://127.0.0.1:${port}/fetch").catch(()=>{});new Image().src="http://127.0.0.1:${port}/img";try{new WebSocket("ws://127.0.0.1:${port}/ws")}catch(e){}console.log("ran");setTimeout(()=>{location.href="http://127.0.0.1:${port}/navigate"},50);` }]);
		const loop = await compileCode("javascript", [{ name: "main.js", content: `setTimeout(()=>{while(true){}},100);setTimeout(()=>console.log("still alive"),1500);` }]);
		assert(escape.ok && loop.ok);
		const docs = [buildRunDocument(escape as never), buildRunDocument(loop as never)];
		// The parent page mirrors the app: frame-src 'none' header + bridge listener.
		const page = http.createServer((req, res) => {
			const doc = docs[req.url === "/loop" ? 1 : 0]!;
			res.setHeader("Content-Type", "text/html");
			res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; frame-src 'none'");
			res.end(`<script>window.got=[];addEventListener("message",e=>{if(e.source===document.querySelector("iframe").contentWindow)got.push(e.data)})</script><iframe sandbox="allow-scripts" srcdoc="${doc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`);
		}).listen(0, "127.0.0.1");
		await new Promise((r) => page.once("listening", r));
		const base = `http://127.0.0.1:${(page.address() as { port: number }).port}`;
		const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
		const messages = async (tab: import("puppeteer-core").Page) => (await tab.evaluate(() => (window as unknown as { got: { kind: string; text?: string }[] }).got)).map((m) => `${m.kind}:${m.text ?? ""}`).join("\n");
		try {
			const a = await browser.newPage();
			await a.goto(`${base}/escape`);
			await new Promise((r) => setTimeout(r, 1500));
			assert.match(await messages(a), /console:ran/, "the hostile script really executed");
			assert.deepEqual(hits, [], `local server saw: ${hits.join(", ")}`);
			const b = await browser.newPage();
			await b.goto(`${base}/loop`);
			await new Promise((r) => setTimeout(r, 3000));
			const started = Date.now();
			const texts = await messages(b);
			assert(Date.now() - started < 2000, "parent stayed responsive");
			assert.match(texts, /longer than 1s/, texts);
			assert.match(texts, /still alive/, "code kept running after the guarded loop");
		} finally {
			await browser.close();
			victim.close();
			page.close();
		}
	});
});
