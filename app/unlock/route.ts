import { randomBytes } from "node:crypto";
export async function GET() {
 const nonce = randomBytes(16).toString("hex");
 return new Response(`<!doctype html><html><head><title>LearnHarness local sign-in</title><meta name="referrer" content="no-referrer"></head><body><p id="status">Signing in to your local LearnHarness…</p><script nonce="${nonce}">
 const token = location.hash.slice(1); history.replaceState(null, "", "/unlock");
 if (!/^[a-f0-9]{64}$/.test(token)) document.getElementById("status").textContent = "Open the private sign-in link printed in your Terminal when starting LearnHarness.";
 else fetch("/api/local-session", {method:"POST",headers:{"x-learnharness-login":token}}).then(r => { if (!r.ok) throw new Error(); location.replace("/"); }).catch(() => document.getElementById("status").textContent = "Sign-in failed. Use the latest link from your Terminal.");
 </script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` } });
}
