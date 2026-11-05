/**
 * The code-answer RUN DOCUMENT (Phase 2): what the sandbox iframe loads.
 * Pure and browser-safe. The document carries the demo CSP (no network,
 * no frames, no forms) and a small bridge that reports console output,
 * errors and completion to the parent via postMessage. The parent accepts
 * messages only from its own iframe and bounds everything it receives.
 */

import { DEMO_CSP } from "./demo-security.ts";
import { boundRunResult, type CodeRunOutputLine, type CodeRunResult } from "./code-answer.ts";

/** Marker on every bridge message. */
export const CODE_RUN_MESSAGE = "lh-code-run";

/** Runs first in the document: console/error capture + the done signal. */
export const CODE_RUN_BRIDGE = `(function(){
var tag=${JSON.stringify(CODE_RUN_MESSAGE)};
var post=function(m){try{m.lh=tag;parent.postMessage(m,"*")}catch(e){}};
var fmt=function(v,d){
 try{
  if(typeof v==="string")return v;
  if(v instanceof Error)return (v.name||"Error")+": "+v.message;
  if(typeof v==="function")return "[Function "+(v.name||"anonymous")+"]";
  if(typeof v==="symbol"||typeof v==="bigint")return String(v);
  if(v&&typeof v==="object"&&v.nodeType===1)return "<"+String(v.tagName).toLowerCase()+">";
  if(v===undefined)return "undefined";
  var seen=[];
  var s=JSON.stringify(v,function(k,x){if(x&&typeof x==="object"){if(seen.indexOf(x)>=0)return "[Circular]";seen.push(x)}if(typeof x==="function")return "[Function]";if(typeof x==="bigint")return String(x);return x});
  return s===undefined?String(v):s;
 }catch(e){return String(v)}
};
["log","info","warn","error","debug"].forEach(function(level){
 var orig=console[level];
 console[level]=function(){
  var parts=[];for(var i=0;i<arguments.length;i++)parts.push(fmt(arguments[i]));
  post({kind:"console",level:level==="debug"?"log":level,text:parts.join(" ").slice(0,4000)});
  try{orig&&orig.apply(console,arguments)}catch(e){}
 };
});
window.addEventListener("error",function(e){post({kind:"error",text:String(e.error?fmt(e.error):e.message).slice(0,4000)})});
window.addEventListener("unhandledrejection",function(e){post({kind:"error",text:("Unhandled promise rejection: "+fmt(e.reason)).slice(0,4000)})});
window.__lhDone=function(){post({kind:"done"})};
})();`;

const escapeScript = (js: string) => js.replace(/<\/script/gi, "<\\/script");

/** The compiled payload from /api/code/compile. */
export type CompiledCode = { mode: "script"; js: string; css: string } | { mode: "html"; html: string };

/** The full srcdoc for one run. */
export function buildRunDocument(compiled: CompiledCode): string {
	const head = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}"><script>${CODE_RUN_BRIDGE}</script>`;
	if (compiled.mode === "html") {
		return `${head}</head><body>${compiled.html}<script>window.__lhDone&&window.__lhDone()</script></body></html>`;
	}
	return `${head}<style>${compiled.css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><script>${escapeScript(compiled.js)}</script><script>window.__lhDone&&window.__lhDone()</script></body></html>`;
}

/** The parent's running view of a run. */
export interface RunState {
	running: boolean;
	result: CodeRunResult;
}

export function freshRunState(): RunState {
	return { running: true, result: { status: "ok", output: [], errors: [] } };
}

/** Fold one untrusted bridge message into the run state (bounded). */
export function reduceRunMessage(state: RunState, data: unknown): RunState {
	if (!data || typeof data !== "object") return state;
	const m = data as { lh?: unknown; kind?: unknown; level?: unknown; text?: unknown };
	if (m.lh !== CODE_RUN_MESSAGE) return state;
	if (m.kind === "done") return { ...state, running: false };
	if (typeof m.text !== "string") return state;
	if (m.kind === "console") {
		const level = (["log", "info", "warn", "error"].includes(m.level as string) ? m.level : "log") as CodeRunOutputLine["level"];
		const next = boundRunResult({ ...state.result, output: [...state.result.output, { level, text: m.text }] });
		return next ? { ...state, result: next } : state;
	}
	if (m.kind === "error") {
		const next = boundRunResult({ ...state.result, status: "error", errors: [...state.result.errors, m.text] });
		return next ? { ...state, result: next } : state;
	}
	return state;
}
