# Local security hardening

This change extends LearnHarness's existing tools, settings, stores, proxy, and demo verifier. It does not add a separate application or agent framework.

## Running this version

1. Stop the previous development server with Control+C. Old running processes do not acquire all these protections automatically.
2. Run `npm run dev` from the repository. The launcher binds to `127.0.0.1` and prints a private `/unlock#...` link.
3. Open that exact link. Its fragment is exchanged for an HttpOnly, SameSite=Strict cookie and removed from browser history. Do not share the link or Terminal output containing it.
4. Restarting the server revokes its browser sessions. The browser cookie expires after eight hours; the startup link can establish another session while that process runs.
5. Open Settings → General to approve learning folders. Empty means no agent file access. Use narrow folders containing only learning material.

`npm start` uses the same local launcher after a production build. `npm run desktop:dev` launches the local server and Electron with the private link. Starting Next directly without the launcher fails closed. Remote hosting is not supported by this security configuration.

## Implemented boundaries

### Learner files

A shared policy protects `read`, `ls`, `find`, `grep`, and PDF-reader dispatch. It checks canonical paths, folder grants, sensitive locations, file type, hard links, and a 25 MiB size ceiling. Walks skip inaccessible/protected entries. Grants are reread for subsequent operations, including PDF tool calls.

Credential names, environment files, SSH/AWS/config directories, macOS Library, application data, and settings are protected even under an approved parent folder. So are `.kube/`, `.docker/`, `.gcloud/`, and `.azure/` directories; shell history files (`.zsh_history`, `.bash_history`, `fish_history`, and similar); `.netrc`; `.pgpass`; any name containing `secret` or `token`; and `service-account*.json`. A `.key` file is blocked only when its content starts with `-----BEGIN`, so Keynote decks remain usable. Name matching can occasionally block an ordinary study file (for example `tokenizer-notes.md`); rename it if needed.

Approving a very broad folder (`/`, the home folder, `/Users`, `/System`, `/Library`, `/Volumes`, `/Applications`, `/private`, or `/etc`) shows a warning in Settings and requires pressing **Save anyway**. The server refuses such a grant unless the request explicitly confirms it. This is an application authorization boundary, not an OS filesystem sandbox. It cannot classify arbitrary sensitive content copied into an otherwise permitted ordinary file. Do not approve folders containing private material you do not intend to share with a model. Already-submitted model context cannot be revoked by changing a grant.

### Local authentication

All API routes and current server-rendered application pages require authorization. The packaged desktop retains its main-frame API capability and uses a private HttpOnly cookie for page navigation. Browser mode requires a per-launch secret from the local launcher, validates Host/origin, rejects cross-site requests, and uses HttpOnly cookies. Response headers prevent framing of application pages.

The public unlock document contains no learning data or credentials. Its script is nonce-restricted by CSP, and its login endpoint validates the startup secret. Cookie authentication is local single-user access control, not protection against malicious software running as the same OS user or a hostile same-user localhost service. Browser cookies are host-scoped rather than port-scoped.

There is no sign-out button. Supported use is a single local user, so restarting `npm run dev` is the revocation mechanism: each launch generates a new secret, and earlier cookies and links stop working. The cookie's eight-hour lifetime is enforced by the browser only; the server accepts the cookie until restart.

### Credential storage

API-key and subscription adapters retain their existing filenames and public interfaces. Files contain AES-256-GCM ciphertext; the wrapping key is kept in macOS Keychain. New plaintext is never written as a fallback. Legacy valid JSON is migrated only after encrypted staging bytes have been decrypted and verified, before an atomic rename. Invalid records and failed writes preserve the previous file. Ordinary key reads fail closed; mutations refuse to overwrite unreadable credentials.

This backend currently supports macOS. Other platforms fail closed until equivalent credential backends are added. Packaged builds on other platforms have not been validated. Environment variables and `.env.local` are not migrated: they remain explicit operator-managed secrets and are blocked from learner tools.

The backend uses the macOS `security` command. A random wrapping key is passed to that command during first creation; provider tokens are never command arguments. The key is cached in the application process. Encryption protects stored files, not a compromised OS account or process. Any program running as the same user can ask the `security` command for the wrapping key, so in practice encryption mainly protects copied files and backups. Test fixtures inject synthetic keys, or an error to simulate an unavailable Keychain, and never require real account credentials.

Live API-key values are redacted (`[redacted]`) from tool results, from model error messages before they are streamed or saved, and from background-capture records (`src/core/secret-redaction.ts`). Redaction matches the exact values of credential-named environment variables, where active keys live after the key store's fill-gap. ChatGPT and other subscription sign-in tokens are not in the environment and are not covered by value redaction; they are never given to learner tools.

### Generated demos

Verification uses a fresh browser context when supported. If Electron cannot provide that isolation, it falls back to a separate sandboxed Chrome process. It no longer launches Chrome with `--no-sandbox`. Request interception and CSP block external/local network and file requests; demos must contain their own code and assets. Provider credentials and local authorization secrets are stripped from browser child environments.

The checker bounds the probe and screenshot steps at 10 seconds each (page load already has a 30-second limit). A demo stuck in a loop therefore fails verification instead of hanging the job, and its browser context is closed afterwards.

In-app demos are click-to-run. Each one first renders as a static, script-free preview; **Run demo** reloads it with `sandbox="allow-scripts"` (never `allow-same-origin`), and **Stop** returns it to the static preview. Scrolling through old chats never executes generated code. Inside the frame, the demo CSP blocks fetch, XHR, WebSocket, images, fonts, and nested frames from any URL. The app's `frame-src 'none'` header blocks the demo from navigating its frame to a local or remote URL, which would otherwise escape the demo CSP. This was confirmed in Chrome: without the header, a demo could load a localhost page and fetch from it; with it, nothing reached the server. The bridge accepts messages only from that demo's own frame and validates their shape.

Remaining limits: in browser mode, a demo stuck in an infinite loop can freeze the LearnHarness tab, because Chrome runs the sandboxed frame in the page's process; reload to recover. WebRTC is not governed by CSP and is not blocked. Downloaded HTML opened outside LearnHarness does not inherit these app protections.

Other generated-content paths were reviewed: Mermaid diagrams render with `securityLevel: "strict"`; model-generated SVG figures are displayed through `<img>` data URLs, where scripts do not run; SVG rasterization for the visual-maker uses the same restricted checker as demos.

## Dependency review

Removed unused `ansi-to-react` and the now-replaced `concurrently` launcher dependency. Updated Zod and Puppeteer and applied targeted patched-version constraints for DOMPurify, Undici 7, brace-expansion, source-map-js, and fast-uri. The installed lockfile was updated without running blanket forced audit fixes.

The final audit reports 23 moderate findings and no high or critical findings. The remaining findings are minimatch advisories in dependency chains. Eliminating those requires coordinated major-version/tooling changes; overriding every consumer to minimatch 11 would change APIs and is not assumed safe. No claim of complete vulnerability elimination is made.

## Validation

See `tests/security-boundaries.test.ts` for denied/granted/revoked file access, symlink and hard-link escapes, protected files, PDF dispatch, local request authentication, encrypted migration/tampering, and demo policy tests. Existing file, credential lifecycle, crash/restart, demo, and desktop tests were adapted to the enforced contracts.

Live smoke checks use a separate copy without personal learning data or credentials. A real macOS Keychain round trip was verified with synthetic data. A real Chrome verifier executed a self-contained script and rejected localhost image/fetch requests.

Remaining scope: no external penetration test, no live provider sign-in, and no signed packaged-app release test. These fixes are not a guarantee against every prompt injection, denial of service, browser vulnerability, or same-user compromise.

Validation results: the full suite passed 3,192 tests; the final file-boundary regression suite passed 44 tests. Type checking passed and lint reported no errors (one pre-existing warning). Browser UI checks verified the private-link redirect, an HttpOnly session cookie, and saving/revoking learning-folder access.

Production build: `npm run build` passed in an isolated copy. Turbopack reported existing broad file-tracing warnings; the temporary webpack diagnostic run was not used as the production validation.

### Phase 1 completion (2026-11-03, local browser use)

Scope: LearnHarness is run only locally, in a browser, with `npm run dev`. Remote hosting, the packaged desktop app, and non-macOS credential storage are out of scope and were not validated.

Added tests in `tests/security-boundaries.test.ts`:
- Proxy authorization: missing or wrong cookie, other-site Origin, cross-site and same-site fetch metadata, DNS-rebinding Host, wrong sign-in secret, the old cookie rejected after a restart, and no access without the launcher.
- Credentials: an unavailable Keychain leaves reads empty, makes writes fail, and leaves the file unchanged; a fresh vault module (restart) reads the same record.
- Redaction, malformed demo-bridge messages, protected names, and broad-folder confirmation.
- A real browser run of a hostile demo: fetch, image, WebSocket, and self-navigation to a local server are all reported as blocked and the server receives nothing. A looping demo fails verification with a timeout. The test is skipped when no browser helper or Chrome is available.

Results:
- Full suite: 3,198 of 3,199 tests passed. The one failure, `chat-flow` "a chat with no model refuses the turn", depends on the developer's real `data/settings.json`. It fails when the strong model is a subscription model that is not connected during tests, and passes against an empty data folder (41 of 41). This is a pre-existing test-isolation issue.
- Type checking passed. Lint reported no errors and one pre-existing warning. `npm run build` passed in place.
- Live smoke test of `npm run dev` with throwaway data: the server listened only on `127.0.0.1`. Requests without a cookie, with a wrong sign-in secret, with an other-site Origin, or with a `localhost` Host returned 403. The real sign-in returned 200, and responses carried `frame-ancestors 'none'; frame-src 'none'`. Approving `/` returned the broad-folder error, and a narrow folder was saved. In the browser, Settings showed the warning and **Save anyway**, and editing the folder text reset the button.
