import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const mode = process.argv[2] === "start" ? "start" : "dev";
const desktop = process.argv.includes("--desktop");
const args = process.argv.slice(3).filter(v => v !== "--desktop");
let port = "3000";
let webpack = false;
for (let i = 0; i < args.length; i++) {
 if (["--hostname", "-H"].includes(args[i])) { if (!["127.0.0.1", "localhost"].includes(args[++i])) throw new Error("Only local loopback binding is supported."); }
 else if (["--port", "-p"].includes(args[i])) port = args[++i];
 else if (args[i] === "--webpack" && mode === "dev") webpack = true;
 else throw new Error(`Unsupported launch option: ${args[i]}`);
}
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error("Invalid port.");
const secret = randomBytes(32).toString("hex");
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/unlock#${secret}`;
// Keep every file the app writes inside its data folder (owner, 2026-11-05):
// the temp folder for the server and everything it starts (esbuild, the
// demo browser, Claude Code's working folder, research downloads, renders),
// and the demo helper's browser profile. data/ is git-ignored.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = process.env.LH_DATA_DIR ? path.resolve(process.env.LH_DATA_DIR) : path.join(repo, "data");
const tmp = path.join(dataRoot, "tmp");
const browserProfile = path.join(dataRoot, "browser-profile");
// No server is running yet, so leftovers from earlier runs can go.
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
fs.mkdirSync(browserProfile, { recursive: true, mode: 0o700 });
const env = { ...process.env, LH_WEB_API_SECRET: secret, LH_WEB_ORIGIN: origin, TMPDIR: tmp, TMP: tmp, TEMP: tmp, LH_BROWSER_PROFILE: browserProfile };
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode, ...(webpack ? ["--webpack"] : []), "--hostname", "127.0.0.1", "--port", port], { env, stdio: "inherit" });
let shell;
console.log(`\nOpen this private local sign-in link in your browser:\n${url}\nDo not share the link. Restarting the server revokes browser sessions.\n`);
child.on("exit", code => { shell?.kill(); process.exit(code ?? 1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { shell?.kill(); child.kill(signal); });
if (desktop) {
 for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`${origin}/unlock`); if (r.ok) { shell = spawn(require("electron"), ["."], { env: { ...env, LH_DEV_URL: url }, stdio: "inherit" }); shell.on("exit", () => child.kill()); break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 300));
 }
 if (!shell) { child.kill(); throw new Error("Local server did not become ready."); }
}
