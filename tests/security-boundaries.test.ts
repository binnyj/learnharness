import assert from "node:assert/strict";
import { test, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-security-check-"));
process.env.LH_DATA_DIR = path.join(tmp, "data");
process.env.LH_AUTH_FILE = path.join(tmp, "auth.json");
const { authorizeSourcePath } = await import("../src/agent/tools/source-access.ts");
const { readTool } = await import("../src/agent/tools/read.ts");
const { lsTool } = await import("../src/agent/tools/ls.ts");
const { findTool } = await import("../src/agent/tools/find.ts");
const { grepTool } = await import("../src/agent/tools/grep.ts");
const { runPdfReaderAgent } = await import("../src/agent/subagents/pdf-reader.ts");
const { localSessionAuthorized, trustedLocalRequest, sameSecret } = await import("../src/server/local-access.ts");
const { restrictDemoHtml, demoEnvelope } = await import("../src/core/demo-security.ts");
const vault = require("../electron/secure-json.cjs");
vault.setTestKey(Buffer.alloc(32, 1));
const allowed = path.join(tmp, "lessons"), outside = path.join(tmp, "outside");
fs.mkdirSync(allowed); fs.mkdirSync(outside); fs.mkdirSync(process.env.LH_DATA_DIR);
const good = path.join(allowed, "lesson.txt"), secretFile = path.join(outside, "private.txt");
fs.writeFileSync(good, "learning content"); fs.writeFileSync(secretFile, "PRIVATE");
function grant(roots: string[]) { fs.writeFileSync(path.join(process.env.LH_DATA_DIR!, "settings.json"), JSON.stringify({ security: { learningFolders: roots.map(p => fs.realpathSync(p)) } })); }
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
test("all learner file entry points deny access before grants", async () => {
 grant([]);
 for (const invoke of [() => readTool.execute("security", {path:good}), () => lsTool.execute("security", {path:allowed}), () => findTool.execute("security", {path:allowed,pattern:"*"}), () => grepTool.execute("security",{path:allowed,pattern:"content"})]) await assert.rejects(invoke, /denied/);
 await assert.rejects(() => runPdfReaderAgent({path:good,question:"read"}), /denied/);
});
test("grants allow ordinary reading but reject traversal, symlinks, secrets and revoked access", async () => {
 grant([allowed]);
 assert.equal(authorizeSourcePath(good), fs.realpathSync(good));
 assert.match(JSON.stringify(await readTool.execute("security", {path:good})), /learning content/);
 assert.throws(() => authorizeSourcePath(path.join(allowed, "..", "outside", "private.txt")), /denied/);
 const link = path.join(allowed,"link.txt"); fs.symlinkSync(secretFile,link);
 assert.throws(() => authorizeSourcePath(link), /denied/);
 const auth = path.join(allowed,"auth.json"); fs.writeFileSync(auth,"{}");
 assert.throws(() => authorizeSourcePath(auth), /protected/);
 const hard = path.join(allowed,"hard.txt"); fs.linkSync(secretFile,hard);
 assert.throws(() => authorizeSourcePath(hard), /hard-linked/);
 const found = JSON.stringify(await findTool.execute("security",{path:allowed,pattern:"*"}));
 assert(!found.includes("auth.json") && !found.includes("link.txt") && !found.includes("hard.txt"));
 const swapRoot = path.join(tmp, "swap-root"); fs.mkdirSync(swapRoot);
 grant([fs.realpathSync(swapRoot)]); fs.rmdirSync(swapRoot); fs.symlinkSync(outside, swapRoot);
 assert.throws(() => authorizeSourcePath(path.join(swapRoot, "private.txt")), /denied/);
 grant([]); assert.throws(() => authorizeSourcePath(good), /denied/);
});
test("protected names inside an approved folder stay blocked; ordinary files and Keynote decks do not", () => {
 grant([allowed]);
 const blocked = [".zsh_history", ".bash_history", ".python_history", "fish_history", ".netrc", ".pgpass", ".kube/config", ".docker/config.json", ".gcloud/creds", ".azure/profile", "notes/secrets.yaml", "notes/api-token.txt", "service-account-prod.json", "keys/server.key"];
 const open = ["notes/lecture.md", "deck.key", "history.md"];
 for (const f of [...blocked, ...open]) { const p = path.join(allowed, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f === "keys/server.key" ? "-----BEGIN PRIVATE KEY-----\nx" : f === "deck.key" ? "PK\u0003\u0004keynote" : "x"); }
 for (const f of blocked) assert.throws(() => authorizeSourcePath(path.join(allowed, f)), /denied/, f);
 for (const f of open) assert.equal(authorizeSourcePath(path.join(allowed, f)), fs.realpathSync(path.join(allowed, f)));
});
test("broad learning folders require explicit confirmation", async () => {
 const { saveLearningFolders, BroadFolderError } = await import("../src/server/security-settings.ts");
 for (const broad of ["/", os.homedir()]) {
  assert.throws(() => saveLearningFolders([broad]), (e: unknown) => e instanceof BroadFolderError && e.folders.length === 1);
  assert.deepEqual(saveLearningFolders([broad], true), [fs.realpathSync(broad)]);
 }
 assert.deepEqual(saveLearningFolders([allowed]), [fs.realpathSync(allowed)]);
});
test("local API sessions reject missing cookies, foreign hosts and cross-origin requests", () => {
 const secret="a".repeat(64), env={LH_WEB_API_SECRET:secret,LH_WEB_ORIGIN:"http://127.0.0.1:3000"};
 const make=(extra:Record<string,string>={})=>new Request("http://127.0.0.1:3000/api/settings",{headers:{host:"127.0.0.1:3000",cookie:`lh_local_session=${secret}`,...extra}});
 assert(localSessionAuthorized(make(),env));
 for(const headers of [{cookie:""},{host:"evil.example"},{origin:"https://evil.example"},{"sec-fetch-site":"cross-site"}]) assert(!localSessionAuthorized(make(Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))),env));
 assert(!trustedLocalRequest(make(),{})); assert(!sameSecret(secret,undefined)); assert(!sameSecret("wrong",secret));
});
test("credential migration verifies ciphertext; wrong-key failures preserve the file", () => {
 const file=path.join(tmp,"credentials.json"), text=JSON.stringify({token:"dummy-test-token"});
 fs.writeFileSync(file,text,{mode:0o600});
 assert.equal(vault.readSecureText(file),text);
 const bytes=fs.readFileSync(file,"utf8"); assert(!bytes.includes("dummy-test-token"));
 assert.equal(fs.statSync(file).mode & 0o777,0o600);
 vault.setTestKey(Buffer.alloc(32,2)); assert.throws(()=>vault.readSecureText(file));
 assert.equal(fs.readFileSync(file,"utf8"),bytes);
 vault.setTestKey(Buffer.alloc(32,1)); assert.equal(vault.readSecureText(file),text);
 const target=path.join(tmp,"credential-link.json");fs.symlinkSync(file,target);assert.throws(()=>vault.readSecureText(target),/Unsafe/);
});
test("demo wrapper restricts requests and isolates scripts from the parent", () => {
 const html=restrictDemoHtml('<script>fetch("http://127.0.0.1/")</script>');
 assert(html.indexOf("Content-Security-Policy") < html.indexOf("<script>"));
 assert(html.includes("connect-src 'none'"));
 assert(demoEnvelope("<script>hi()</script>").includes('sandbox="allow-scripts"'));
});

// ─── Phase 1 completion (2026-11-03) ─────────────────────────────────────────

test("proxy: browser sessions need the launch cookie from the trusted local origin", async () => {
 const { NextRequest } = await import("next/server");
 const { proxy } = await import("../proxy.ts");
 const saved = { ...process.env };
 const secret = "b".repeat(64), origin = "http://127.0.0.1:3311";
 try {
  delete process.env.LH_DESKTOP_SERVER; delete process.env.LH_DESKTOP_API_SECRET;
  process.env.LH_WEB_API_SECRET = secret; process.env.LH_WEB_ORIGIN = origin;
  const call = (pathname: string, headers: Record<string, string>, method = "GET") => proxy(new NextRequest(`${origin}${pathname}`, { method, headers: { host: "127.0.0.1:3311", ...headers } }));
  const ok = { cookie: `lh_local_session=${secret}` };
  const granted = call("/api/settings", ok);
  assert.equal(granted.status, 200);
  assert.match(granted.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'; frame-src 'none'/);
  assert.equal(call("/chat/abc", ok).status, 200, "pages use the same cookie");
  for (const [label, headers] of Object.entries<Record<string, string>>({
   "no cookie": {},
   "wrong cookie": { cookie: `lh_local_session=${"c".repeat(64)}` },
   "other-site origin": { ...ok, origin: "https://evil.example" },
   "cross-site fetch": { ...ok, "sec-fetch-site": "cross-site" },
   "same-site other port": { ...ok, "sec-fetch-site": "same-site" },
   "DNS-rebinding host": { ...ok, host: "evil.example:3311" },
  })) assert.equal(call("/api/settings", headers).status, 403, label);
  assert.equal(call("/api/local-session", { "x-learnharness-login": "d".repeat(64) }, "POST").status, 403, "bad sign-in secret");
  assert.equal(call("/api/local-session", { "x-learnharness-login": secret }, "POST").status, 200, "startup secret signs in");
  // Restart = new launch secret: the old cookie stops working.
  process.env.LH_WEB_API_SECRET = "e".repeat(64);
  assert.equal(call("/api/settings", ok).status, 403, "old cookie rejected after restart");
  // Starting Next without the launcher fails closed.
  delete process.env.LH_WEB_API_SECRET; delete process.env.LH_WEB_ORIGIN;
  assert.equal(call("/api/settings", ok).status, 403, "no launcher, no access");
 } finally {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
 }
});

test("unavailable Keychain: reads fail closed, writes refuse, the credential file is kept", async () => {
 const { authStore } = await import("../src/store/auth.ts");
 const { AUTH_FILE } = await import("../config.ts");
 vault.setTestKey(Buffer.alloc(32, 1));
 authStore.setAuthVar("OPENAI_API_KEY", "sk-test-dummy-value-123456");
 const before = fs.readFileSync(AUTH_FILE, "utf8");
 assert(!before.includes("sk-test-dummy"), "stored encrypted");
 vault.setTestKey(new Error("Keychain locked"));
 try {
  assert.deepEqual(authStore.authVars(), {}, "no keys rather than garbage");
  assert.throws(() => authStore.setAuthVar("OPENAI_API_KEY", "sk-other-dummy-value-999"));
  assert.throws(() => authStore.deleteAuthVar("OPENAI_API_KEY"));
  assert.equal(fs.readFileSync(AUTH_FILE, "utf8"), before, "file untouched");
 } finally { vault.setTestKey(Buffer.alloc(32, 1)); }
 // Restart: a fresh copy of the vault module (empty cache) reads the same record.
 const fresh = require.resolve("../electron/secure-json.cjs"); delete require.cache[fresh];
 const reloaded = require(fresh); reloaded.setTestKey(Buffer.alloc(32, 1));
 assert.match(reloaded.readSecureText(AUTH_FILE), /sk-test-dummy-value-123456/);
 assert.equal(authStore.authVars().OPENAI_API_KEY, "sk-test-dummy-value-123456");
});

test("live API keys are redacted from tool results and saved error text", async () => {
 const { secretValues, redactSecrets, redactDeep } = await import("../src/core/secret-redaction.ts");
 const { toToolResult } = await import("../src/agent/tool-execute.ts");
 const env = { OPENAI_API_KEY: "sk-live-dummy-abcdef123456", LH_WEB_API_SECRET: "f".repeat(64), HOME: "/Users/someone", SHORT_TOKEN: "abc" };
 const secrets = secretValues(env);
 assert.deepEqual(new Set(secrets), new Set([env.OPENAI_API_KEY, env.LH_WEB_API_SECRET]), "only credential-named values of useful length");
 assert.equal(redactSecrets(`401: Incorrect API key ${env.OPENAI_API_KEY}`, secrets), "401: Incorrect API key [redacted]");
 assert.deepEqual(redactDeep({ a: [env.OPENAI_API_KEY], n: 3 }, secrets), { a: ["[redacted]"], n: 3 });
 const saved = process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
 try {
  const result = toToolResult({ page: `token=${env.OPENAI_API_KEY}` });
  assert(!JSON.stringify(result).includes(env.OPENAI_API_KEY));
  assert.match(JSON.stringify(result), /\[redacted\]/);
 } finally { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; }
});

test("demo bridge ignores malformed messages", async () => {
 const { reduceDemoBridgeState, INITIAL_DEMO_BRIDGE_STATE: s0 } = await import("../components/artifacts/demo-card.tsx");
 for (const junk of [null, "demo-resize", { type: "demo-resize", height: "9999" }, { type: "demo-resize", height: Infinity }, { type: "demo-resize", height: -5 }, { type: "unknown", height: 500 }])
  assert.equal(reduceDemoBridgeState(s0, junk), s0);
 assert.equal(reduceDemoBridgeState(s0, { type: "demo-resize", height: 1e9 }).height, 2400, "height is clamped");
 assert.equal(reduceDemoBridgeState(s0, { type: "demo-error", message: 42 }).error, "unknown error", "non-string error text is not rendered");
});

test("real browser: a hostile demo cannot reach localhost, and a looping demo cannot hang the checker", { timeout: 120_000 }, async (t) => {
 const { realHeadless } = await import("../src/agent/subagents/headless.ts");
 if (!realHeadless.available()) return t.skip("no browser helper or Chrome installed");
 const http = await import("node:http");
 const { execFileSync } = await import("node:child_process");
 const hits: string[] = [];
 const server = http.createServer((req, res) => { hits.push(req.url ?? ""); res.end("<script>fetch('/after-navigation')</script>"); }).listen(0, "127.0.0.1");
 await new Promise(r => server.once("listening", r));
 const port = (server.address() as { port: number }).port;
 const run = (html: string, probe?: string) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, "helpers/hostile-demo-run.ts"), html, ...(probe ? [probe] : [])], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, timeout: 90_000 }).trim().split("\n").at(-1)!);
 try {
  const hostile = `<script>fetch("http://127.0.0.1:${port}/fetch").catch(()=>{});new Image().src="http://127.0.0.1:${port}/img";try{new WebSocket("ws://127.0.0.1:${port}/ws")}catch(e){}setTimeout(()=>{location.href="http://127.0.0.1:${port}/navigate"},100)</script>`;
  const hostileRun = run(hostile);
  // Proof the script ran: each attempt was reported as blocked by the demo policy.
  const blocked = hostileRun.consoleErrors.join("\n");
  for (const attempt of ["/fetch", "/ws", "/img", "Framing"]) assert(blocked.includes(attempt), `${attempt} not reported blocked: ${blocked}`);
  assert.deepEqual(hits, [], `local server saw: ${hits.join(", ")}`);
  const started = Date.now();
  const looping = run(`<script>setTimeout(()=>{while(true){}},200)</script>`, "1+1");
  assert.equal(looping.ok, false);
  assert(looping.pageErrors.some((e: string) => /timed out/.test(e)), JSON.stringify(looping.pageErrors));
  assert(Date.now() - started < 60_000, "checker gave up promptly");
 } finally { server.close(); }
});
