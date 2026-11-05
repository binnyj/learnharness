# Local security hardening

This change extends LearnHarness's existing tools, settings, stores, proxy, and demo verifier. It does not add a separate application or agent framework.

## Running this version

1. Stop the previous development server with Control+C. Old running processes do not acquire all these protections automatically.
2. Run `npm run dev` from the repository. The launcher binds to `127.0.0.1` and prints a private `/unlock#...` link.
3. Open that exact link. Its fragment is exchanged for an HttpOnly, SameSite=Strict cookie and removed from browser history. Do not share the link or Terminal output containing it.
4. Restarting the server revokes its browser sessions. The browser cookie expires after eight hours; the startup link can establish another session while that process runs.
5. Open Settings → Agent → Tools → File access to add allowed folders. Restriction is on by default: with no folders the tutor reads no files. Folders approved under the earlier local setting carry over. Use narrow folders containing only learning material; adding a very broad folder (/, home, top-level system folders) asks for a second click.

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

## Code answers: execution threat model (Phase 2 security gate)

Scope: learner and tutor-authored code in `code`/`probe_code` questions and practice code problems, compiled by the local server and run in the browser. Supported setup: local, single-user, browser mode on macOS.

**What is protected:** API keys and subscription credentials, the local session cookie and launch secret, chats and the knowledge graph, learner files outside approved folders, and other services on the machine or local network.

**Who is untrusted:** all code being compiled or run. That includes learner code and tutor-authored starter code, which may itself be shaped by prompt injection from a web page or document.

**Compilation (server).** `POST /api/code/compile` requires the local session like every API route. esbuild parses and bundles; it never executes learner code. Learner files live in a virtual namespace: relative imports resolve only to the question's own files, bare imports only to `react`/`react-dom` (React questions) or `vue` (Vue questions), and everything else (`fs`, absolute paths, `../`) is refused with an error. Inputs are limited to 8 flat files of 50,000 characters each. HTML questions inline only their own `.css`/`.js` files.

**Execution (browser).** Runs happen only in an iframe with `sandbox="allow-scripts"` (never `allow-same-origin`, popups, forms or top navigation), so code has an opaque origin with no access to app cookies, storage or DOM. The document carries the demo CSP (`default-src 'none'`, `connect-src 'none'`, `img-src data: blob:`, `frame-src 'none'`, `form-action 'none'`), and the app's own `frame-src 'none'` header stops the frame from navigating itself elsewhere. The parent accepts bridge messages only from that run's iframe, and bounds console output (200 lines, 20,000 characters) and errors (20) before showing or submitting them; the server bounds them again when the answer arrives.

**Runaway code.** Every loop in learner code gets a guard that throws after 1 second. Unbounded recursion ends with the browser's own stack-overflow error. Stop removes the iframe.

**Data sent to the model.** The submitted files and the bounded run evidence, as text. Submitted files must be exactly the question's files (names unchanged); the server rejects anything else. Code comments and console text are treated as data in the prompts, never instructions.

**Drafts.** Unsubmitted drafts are stored under `data/code-drafts/<chatId>.json` (mode 0600), cleared when a question is answered, and deleted with the chat. Practice drafts persist across submissions to the same problem (so the learner can revise) until the chat is deleted, with at most 200 drafts per chat.

**Residual risks (accepted for local single-user use):**
- CPU work that is not a loop, such as catastrophic regex backtracking, can still freeze the LearnHarness tab; reload recovers.
- Memory exhaustion or timers that never stop (`setInterval`) slow the tab until Stop or reload.
- WebRTC is not governed by CSP.
- The esbuild binary parses untrusted text on the server. It is a memory-safe Go program and runs only on loopback behind the session check.
- A learner who pastes a secret into their own code sends it to the model; redaction covers only configured API-key values in tool results and errors.

## Merge with main's file-access system (2026-11-04)

`main` added an optional learner-folder restriction (Settings → Agent → Tools → File access) with multi-folder roots, Windows path handling, one policy snapshot per tool call, and mandatory denials for credential and agent-transcript locations under the home folder. The merge keeps that system as the single implementation and drops the earlier local folder panel and `/api/security/folders`. Owner decisions:

- Restriction is **on by default**. Missing settings, a missing `fileAccess` preference, or a preference without `restricted` all mean restricted; only an explicit `restricted: false` allows broad reads. Folders saved under the earlier `security.learningFolders` setting carry over.
- The local extras apply on top of main's denials, inside allowed folders too:
  - names refused anywhere: shell history files, `.netrc`, `.pgpass`, `.npmrc`, `auth.json`, `*credentials*`, `*secret*`, `*token*`, `service-account*.json`, `.pem`/`.p12`/`.pfx`, SSH private key names, and `.ssh`/`.aws`/`.gnupg`/`.kube`/`.docker`/`.gcloud`/`.azure` folders
  - checked by content: hard-linked files, files over 25 MiB, and PEM-encoded `.key` files (Keynote decks stay readable)
  - the encrypted credential writer's staging file
- Adding a very broad folder asks for a second click in the editor. That check runs in the browser only; the server accepts whatever folder list is saved.
- Credentials stay encrypted. The encrypted writer refuses to write through a symlinked credential file instead of replacing it, and retries Windows sharing violations like main's atomic-write helper.
