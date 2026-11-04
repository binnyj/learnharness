# LearnHarness security and code-input checklist

Created: 2026-11-03. Rewritten 2026-11-03: interview mode dropped; learning comes first.

Status: Phase 1 (security foundations) is complete for the supported setup: local, single-user, browser mode via `npm run dev` on macOS. Items that only apply to remote hosting, the packaged desktop app, or other operating systems are marked N/A with the reason. See `docs/security-hardening.md` for boundaries, limitations, and evidence. Phase 2 onward has not started.

## Objective

Let the learner answer in code, not only by talking or choosing options, so coding skills are produced and ingrained rather than recognized. Code becomes a new answer type inside the sessions LearnHarness already has (teaching checks and practice problems), governed by the same method. LearnHarness stays a general learning tool; nothing here reshapes it around job interviews.

This document records proposed work and acceptance criteria. Mark an item complete only after its acceptance criteria have been verified, and record material limitations rather than checking an incomplete item.

## Guardrails — the fundamentals every item must protect

Each item below is tagged with the guardrails it touches. An item is not complete until it is shown not to weaken them. Any change to a guardrail itself needs the owner's explicit approval.

- **G1 — The method.** Start from what the learner holds, move one reasoning step at a time, check after every step, and finish when the goal feels obviously true (`docs/teaching-methodology.md`). Teacher and prober prompts change only with owner approval.
- **G2 — Measure before teaching.** The prober → teacher split and the practice lifecycle (`problem` → thinking → `conclude`) stay intact. A code answer is evidence the tutor judges, like a free-recall answer, not a separate grading system.
- **G3 — Practice doctrine.** Practice demands production of held propositions from the inactive state (`src/agent/prompts/practice/10-doctrine.md`). Not an exam, not re-teaching, not long competition-shaped search problems. Code problems are short and decision-dense.
- **G4 — Graph integrity.** The graph holds only true propositions and their chains. Understanding is inferred, never stored. No scores, attempts or code are written into the graph, and practice sessions keep skipping extraction unless the owner decides otherwise.
- **G5 — One lifecycle.** One chat record, admission, streaming, cancellation, recovery and background-job system. No second engine or parallel agent framework. Old saved chats keep loading (golden fixtures).
- **G6 — Provider neutrality.** Everything works with API keys, subscriptions, and Claude Code. Nothing depends on one provider's special features.
- **G7 — Security boundaries.** The Phase 1 boundaries (folder grants, local sign-in, credential storage and redaction, sandboxed execution) stay in force. Learner code runs only behind the security gate below.

## Architectural commitments

- [ ] Extend the existing application; do not create a separate app or parallel agent framework. *(G5)*
- [ ] Keep domain contracts in `src/core/`, persistence in `src/store/`, orchestration in `src/server/`, agent behavior in `src/agent/`, transport in `app/api/`, and interface components in `components/`. *(G5)*
- [ ] Code answers plug into existing question tools and the practice lifecycle; they do not replace multiple choice, free recall, or conversation. *(G1, G2)*
- [ ] Keep credentials and privileged operations outside learner code and preview frames. *(G7)*
- [ ] Keep answers and attempt evidence out of the knowledge graph's propositions and chains. *(G4)*
- [ ] Read applicable repository instructions and installed framework documentation before implementation. Resolve design choices and approve an implementation plan for each milestone. *(all)*

## Phase 1 — Security foundations

### 1. Restrict learner file tools — high priority; medium difficulty

Current evidence: `src/agent/tools/fs-shared.ts` resolves paths against the home directory and accepts absolute paths. `src/agent/tools/read.ts` reads the resolved path without a folder grant. Walking exclusions do not prevent direct reads.

- [x] Define explicit approved learning folders, with no unrestricted home access by default.
- [x] Implement one shared authorization function for `read`, `ls`, `find`, and `grep`.
- [x] Canonicalize paths and enforce containment after resolving symlinks; reject traversal and sibling-prefix escapes.
- [x] Apply policy to direct reads and traversal roots, not just recursive walking.
- [x] Exclude application credential files and agreed sensitive locations even when a broad parent folder is selected.
- [x] Add a settings interface for granting and revoking folder access.
- [x] Return actionable access-denied messages without disclosing protected file contents.
- [x] Update learner-file prompts to reflect enforced permissions.
- [x] Test allowed files, outside paths, symlinks, revoked grants, and all four tool entry points.

Acceptance: agent tools cannot read outside approved scope even when a prompt explicitly requests it. OS permissions remain an additional boundary.

### 2. Protect credentials — medium difficulty

Current evidence: `src/store/auth.ts` writes plaintext JSON with mode `0600` and atomic replacement. This protects against some other-user access, not same-user processes or the app's own unrestricted reader.

- [x] Inventory API-key and subscription credential stores without printing actual credentials.
- [x] Preserve existing auth adapter interfaces while evaluating OS-backed credential storage for desktop mode.
- [x] Specify supported storage behavior for browser mode and platforms without the selected secure store.
- [x] Design a recoverable migration from existing credential files; do not delete usable credentials before verifying migration.
- [x] Ensure API responses, logs, tool results, and saved exercise artifacts never expose secrets. The keys API returns only masked values. Live key values are redacted from tool results, model error messages (streamed and saved), and background-capture records. Server logs go only to the local Terminal. Subscription tokens are not value-redacted (see the doc).
- [x] Keep agent file tools blocked from credential locations regardless of storage migration.
- [x] Test migration, unavailable secure storage, restart behavior, and redaction using dummy credentials.

Acceptance: credentials remain usable through existing provider connections and are unavailable to learner tools and code runtimes. Document remaining same-user/OS limitations.

### 3. Authenticate browser-mode APIs — high priority; medium difficulty

Current evidence: `src/server/desktop-access.ts` allows requests when the desktop marker and secret are absent. `proxy.ts` applies this guard across API routes. Packaged Electron uses a private per-launch capability; browser mode does not receive equivalent authentication by default.

- [x] Preserve the packaged desktop capability and main-frame checks in `electron/desktop-api.cjs`.
- [x] Design browser authentication with a secure local bootstrap and session lifecycle.
- [x] Protect every API method, including streams, reads, settings mutations, and spending operations.
- [x] Validate trusted hosts/origins and protect state-changing requests against CSRF.
- [x] Default development and browser launch commands to loopback binding.
- [x] Make any remote-access configuration explicit and authenticated.
- [x] Test missing/invalid credentials, hostile origins, and logout/revocation. Revocation means a restart; there is no sign-out button, by decision. Desktop compatibility: N/A, local browser-only.

Acceptance: an unauthenticated client cannot read sessions, change settings, or start model work. Verify actual listening interfaces in each launch mode.

### 4. Harden generated-content execution — high priority; high difficulty

Current evidence: `src/agent/subagents/headless.ts` launches fallback Chrome with `--no-sandbox` and loads generated HTML for verification. The visible demo component separately uses a sandboxed iframe. These are different execution boundaries.

- [x] Remove the fallback's sandbox-disabling option and verify supported environments can launch safely.
- [x] Fail clearly if safe execution is unavailable rather than silently weakening isolation.
- [x] Isolate generated content from application files, credentials, authenticated sessions, and desktop capabilities. Demos use an opaque-origin sandbox without `allow-same-origin`, and the checker runs without secrets in its environment.
- [x] Specify and enforce network policy, including loopback/private-network destinations, redirects, and permitted dependencies. No network access at all: the demo CSP plus the app's `frame-src 'none'`, confirmed in Chrome. WebRTC is a documented residual.
- [x] Preserve iframe restrictions in `components/artifacts/demo-card.tsx` and validate bridge message sources and payloads. Demos are click-to-run.
- [x] Isolate browser state between jobs and clean up contexts/processes after completion or failure.
- [x] Add execution timeouts, cancellation, and recovery for runaway code; document resource-limit guarantees. The checker has a 10-second step limit and closes its context afterwards. In the app, Stop returns a demo to the static preview. A tight loop can still freeze the browser tab until reloaded; this is documented.
- [x] Review all other generated-content paths that use the same browser helper, including fallbacks.
- [x] Test hostile generated content using controlled fixtures and no real secrets.

Acceptance: generated content cannot access app credentials or privileged APIs, and prohibited network/file access fails in both verification and visible previews. Do not equate an iframe sandbox with OS-level isolation.

### 5. Security regression and dependency checks — medium difficulty

- [x] Extend existing tests, including `tests/desktop-api.test.ts`, browser-service tests, and file-tool tests.
- [x] Audit the lockfile against current advisories and triage reachability and severity.
- [x] Update affected dependencies with compatibility checks; avoid blanket forced upgrades.
- [x] Verify generated markup rendering. Desktop IPC authorization and navigation controls: N/A, local browser-only.
- [x] Run relevant unit/integration tests, type checking, linting, and build checks. One pre-existing `chat-flow` test depends on the real `data/settings.json`; see the doc.
- [x] Smoke-test browser mode. Packaged desktop: N/A, local browser-only.
- [x] Record confirmed findings, fixes, remaining limitations, and reproduction evidence.

Security gate: approve the execution threat model and resolve relevant isolation/access-control failures before enabling learner-authored code. Still open: this gate applies to the Phase 2 learner-code runtime, not to demos.

## Phase 2 — Code as an answer type

### 6. Code answer contract — medium difficulty

Integration: `src/core/contracts/chat.ts`, `src/core/input-events.ts`, `src/core/question-core.ts`, `src/agent/tools/practice.ts`, the teacher's question tools.

- [x] Decide how code is requested: a dedicated code-question tool for teaching and a code option on `problem` for practice (see Decisions). *(G1, G2)*
- [x] Define the request: instructions, language, starter files, optional run mode (none / preview / checks), and a reference solution committed at pose time and revealed the same way practice solutions are. *(G2)* `src/core/code-answer.ts`; `run` is on/off, and checks are Phase 3.
- [x] Define the answer event: an immutable snapshot of the submitted files plus any run evidence, linked to its chat and question occurrence. *(G2, G5)* Teaching: the question's tool result. Practice: a `Your code` marker. Run evidence is flagged stale when the files changed after the run.
- [x] The agent judges the code the way it judges free recall, with no new deterministic grader. *(G2)*
- [x] Validate file names, sizes, language and incoming payloads. *(G7)* Checked in the tools, the answer/code inputs (files must match the question's), and the compile route; run evidence is re-bounded on the server.
- [x] Existing answer types and saved chats are unchanged; golden fixtures still pass. *(G5)*

Acceptance: a teaching check and a practice problem can each request and receive code; existing sessions load and run unchanged.

### 7. Editor in the answer dock — medium difficulty

Integration: `components/practice-dock.tsx`, the question dock in `components/chat.tsx`, existing session state.

- [x] Choose an editor after checking licensing, bundle size, accessibility, and framework compatibility (CodeMirror 6 is the leading candidate). *(G5)* CodeMirror 6 (MIT); loaded with a normal import, because a lazily loaded chunk caused a reload loop in dev.
- [x] Show the editor only when a question asks for code; other answer types are untouched. *(G1, G2)*
- [x] Support JavaScript, TypeScript/JSX, HTML, and CSS; one file first, file tabs when a question needs several. *(G1)* Also Vue 3 JSX/TSX (owner).
- [x] Scope keys so Enter types a newline and only an explicit shortcut or button submits. *(G2)* ⌘/Ctrl+Enter or the button; verified in the browser.
- [x] Keep drafts across refresh and restart until submitted; never lose unfinished code. *(G5)* Server drafts; cleared only after the answer is durably saved (a refused submit keeps the code; verified in the browser).
- [ ] Keep the tutor and conversation reachable while editing; define compact-window layout and keyboard navigation. *(G1)* Partly done: the transcript stays scrollable above the dock; Tab indents and Escape leaves the editor. A compact-window layout has not been designed or checked.

Acceptance: the learner can write, edit, and submit code in the dock without leaving LearnHarness or losing work.

### 8. Running code safely — high difficulty

Integration: the Phase 1 demo sandbox (`src/core/demo-security.ts`, `components/artifacts/demo-card.tsx`, `proxy.ts`).

- [ ] Write the execution threat model and pass the security gate before any learner code runs. *(G7)* Threat model written (`docs/security-hardening.md`) and hostile tests pass; the gate needs owner sign-off.
- [x] Reuse the demo sandbox: opaque origin, demo CSP, the app's `frame-src 'none'`, no network. *(G7)*
- [x] Compile JSX/TypeScript and resolve imports between the question's files. *(G7)* Per owner decision: on the local server with esbuild, not in the browser; only the question's files and an allowlist are importable.
- [x] Serve React and any other supported libraries from the app itself, because the network is blocked. *(G7)* React, React DOM and Vue are bundled from the app's node_modules (development builds, for their warnings).
- [x] Add a loop guard that stops runaway loops, plus a Stop control; document what a reload recovers. *(G7)*
- [x] Capture console output and compile/runtime errors through the bridge, bounded and sanitized, tied to the exact files that produced them. *(G2, G7)*
- [x] Running is optional per question; when the question's run mode is none, nothing executes. *(G1)*

Acceptance: a learner can run a React component and see its output and errors in the dock; hostile fixtures (network, navigation, infinite loop) fail safely.

### 9. The tutor works with the code — medium–high difficulty

Integration: teacher and practice prompts, `src/agent/tools/practice.ts`, conclusion projections.

- [x] The submitted snapshot and run evidence reach the agent as the answer, not a stale draft. *(G2, G5)*
- [ ] Teaching: a code check follows the method; on a mistake the teacher repairs the exact step before continuing and never builds on code the learner does not yet hold. Prompt changes need owner approval. *(G1)* Partly observed (live, gpt-6.1-sol): the prober settled the goal, then asked for code with `probe_code` and graded a buggy answer precisely ("increment works; Reset needs setCount(0)"), then moved its probe up a level. A teach-phase `code` check after `plan_init` has not been observed yet.
- [ ] Practice: code problems are short, decision-dense uses of held propositions, not long search problems; corrections are minimal nudges. *(G3)* Observed once (live): the practitioner posed a short `.map()` code problem with a JavaScript starter, judged the submitted code and run as solved, revealed its solution, and paused for Next problem. A miss-and-nudge path has not been observed yet.
- [ ] Treat code comments, console output, and imported content as untrusted data, never instructions. *(G7)* In the prompt; a prompt cannot guarantee it. Not yet observed with a real model.
- [x] Code reaches every provider as text; enforce context limits without silently dropping files. *(G6)* Text only; files are capped at 8 × 50,000 characters and never silently trimmed.
- [x] Hints and solution reveal keep their existing behavior. *(G2)*

Acceptance: the tutor's feedback is about the code actually submitted, and lessons still move one checked step at a time.

## Phase 3 — Checks that run

### 10. Optional automatic checks — high difficulty

- [ ] The tutor can attach a few behavior checks to a code question when they help. *(G1, G2)*
- [ ] Before posing, the checks must pass against the committed reference solution; checks that fail it are not used. *(G2)*
- [ ] Run checks in the hardened headless checker, where the result collector lives outside the page and learner code cannot fake results. *(G7)*
- [ ] Show passed, failed, timed-out, and infrastructure-error results distinctly; an infrastructure error never counts as passing. *(G2)*
- [ ] Results are evidence for the tutor's judgment, not a grade, and are never written to the graph. *(G2, G4)*

Acceptance: check results come from real execution against the submitted snapshot, and the tutor's feedback distinguishes them from its own judgment.

## Phase 4 — Later, pending design

### 11. System design as an answer type — on hold

On hold by owner decision (2026-11-03). No design work until it is picked up again.

- [ ] Approve a design that fits the method before any implementation (see Decisions). *(G1–G5)*

### 12. Attempt history — optional

- [ ] Store attempts, outcomes, hints used, and evidence separately from the graph's propositions. *(G4)*
- [ ] Link attempts to graph propositions only through existing `conclude` targets; never store mastery scores. *(G4)*
- [ ] Support review and deletion of history. *(G5)*

Acceptance: later sessions can use prior evidence without treating an AI judgment as a skill rating.

## Completion checklist

- [ ] Run focused security, contract, persistence, runtime, and agent-flow tests. *(G5, G7)*
- [ ] Test restart, refresh, cancellation, failed saves, failed model calls, and interrupted execution. *(G5)*
- [ ] Test old chats and ordinary teaching and practice sessions for regressions. *(G1, G2, G5)*
- [ ] Run a teaching session and a practice session end to end with code answers, and confirm the method still holds step by step. *(G1, G2, G3)*
- [ ] Confirm nothing new was written to the graph. *(G4)*
- [ ] Run with an API key, a subscription, and Claude Code. *(G6)*
- [ ] Complete type checking, linting, production build, and a live `npm run dev` smoke test. *(G5, G7)*
- [ ] Document setup, supported languages and libraries, and known limitations. *(all)*

## Decisions to resolve before the relevant stage

- [x] Exact folder-grant UX and sensitive-path policy.
- [x] Browser authentication/bootstrap and supported remote-access scope. Local only; no remote access.
- [x] Secure credential storage strategy per supported platform. macOS Keychain only; other platforms N/A.
- [x] Interview mode, timers, and an interview exercise library: dropped (owner, 2026-11-03).
- [x] How code is requested (owner, 2026-11-03): teaching gets a dedicated code-question tool that works like `explain` and is available whether the session uses multiple-choice or free-recall checks; practice gets a code option on `problem`.
- [x] When the tutor asks for code instead of words or options: approved wording added to the shared question-tools, prober, teacher question-principles, and practice base prompts (owner, 2026-11-03). The prober can ask for code too (`probe_code`); the teaching tool is `code`.
- [x] Which teaching phases may ask for code: both teaching checks and practice problems from the start (owner, 2026-11-03).
- [x] Editor library: CodeMirror 6. Languages: React (JSX/TSX), Vue 3 (JSX/TSX), JavaScript/TypeScript, HTML + CSS. Files are set by the tutor; the learner edits contents only (owner, 2026-11-03).
- [x] Runtime: the local server bundles with esbuild, with only the submitted files plus react, react-dom and vue importable; a loop guard stops a loop that runs over 1 second; execution happens in the Phase 1 sandbox (owner, 2026-11-03).
- [x] Teacher and practice prompt changes for code answers: approved (see above). The tutor receives files plus run status, console output and errors as text only; no screenshots (owner, 2026-11-03).
- [ ] When checks are attached and whether the learner sees them. *(before item 10)*
- [ ] System design: answer format, how designs are judged, and initial scope. *(before item 11)*
- [x] Draft retention and reset behavior: drafts autosave on the server per chat, are restored on reload, are cleared on submit or dismissal, are deleted with the chat, and have a confirmed Reset to starter files (owner, 2026-11-03).

## Milestone order

1. Security foundations and verification (done).
2. Code answers in teaching checks and practice, with the editor, safe running, and tutor review.
3. Optional automatic checks.
4. System design and attempt history, after their designs are approved.

## Security validation snapshot

- Full suite: 3,192 tests passed. A final folder-root symlink regression and related file tests also passed (44 tests).
- Type checking passed; lint has no errors and one pre-existing warning.
- Real local HTTP tests verified sign-in, denied unauthorized API/chat requests, and rejected foreign origins.
- Real Chrome verification executed self-contained code and blocked localhost requests.
- Real macOS Keychain encryption/decryption was verified using synthetic data only.
- Residual advisories and platform/runtime limitations are documented in `docs/security-hardening.md`. Packaged release validation remains unchecked.

- Real-browser UI verification: folder grants and revocation persisted; the session cookie was inaccessible to page JavaScript.

- Production build passed in an isolated copy. Current npm audit: 0 critical, 0 high, 23 moderate (remaining minimatch dependency advisories).

## Phase 1 completion snapshot (2026-11-03)

- Supported setup: local, single-user, browser mode (`npm run dev`) on macOS.
- Added: an expanded sensitive-file blocklist, a confirm step for broad folders, click-to-run demos with `frame-src 'none'`, step timeouts in the demo checker, and API-key redaction. Also fixed the misplaced `"use strict"` lines in two Electron credential files.
- Full suite: 3,198 of 3,199 passed. The one failure is an environment-dependent `chat-flow` test that reads the real settings; it passes with isolated data.
- Type checking passed. Lint: 0 errors, 1 pre-existing warning. Production build passed in place.
- Live `npm run dev` smoke test (throwaway data): loopback-only listener; 403 for no cookie, wrong secret, other-site Origin, and wrong Host; frame-src header present; the broad-folder warning and Save anyway verified in the browser.
- Real-browser hostile demo test: all localhost requests were blocked; a looping demo timed out cleanly.

## Phase 2 build snapshot (2026-11-03)

- Implemented:
  - `code` (teaching) and `probe_code` (probing) question tools, available under either quiz setting
  - a code option on practice `problem`
  - CodeMirror workspace with file tabs, Run/Stop, preview and console, server-saved drafts, and a confirmed reset
  - an esbuild compile route with an import allowlist and loop guards
  - answered-card and practice-card views
  - the four approved prompt passages
- Tests: 3,223 of 3,223 passed with isolated data. New: `tests/code-answers.test.ts` (contract, record seams, tools, compiler escapes, loop guard, run document, drafts, and hostile code in real Chrome) and `tests/code-answers-render.test.tsx`.
- Type checking passed. Lint: 0 errors, 1 pre-existing warning. Production build passed; under `npm start` the compile route served React and Vue and refused a request without the session cookie.
- Browser check with throwaway data, no model:
  - React rendered and was interactive ("Clicked 2 times").
  - Vue rendered.
  - JavaScript printed its console output.
  - HTML inlined its CSS and JS.
  - TypeScript practice ran, and Submit code sent a `code` input.
  - Drafts survived reload and a refused submit.
  - The answered card showed the files, run status and solution.
- Found and fixed during the live check:
  - The package lookup failed inside Next's bundled route.
  - The lazily loaded editor caused a dev reload loop.
  - Drafts were cleared before the server accepted the answer.
- Live model check (gpt-6.1-sol, your real data): probing asked for code and graded a buggy answer precisely; practice posed a short code problem, concluded it as solved and paused correctly. Two sessions from this check are in your session list.
- Not yet done: a teach-phase `code` check after the plan; a practice miss-and-nudge; a compact-window layout; your sign-off on the security gate.
