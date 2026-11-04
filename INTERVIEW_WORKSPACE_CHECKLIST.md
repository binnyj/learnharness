# LearnHarness security and interview workspace checklist

Created: 2026-11-03

Status: Phase 1 (security foundations) complete for the supported setup: local, single-user, browser mode via `npm run dev` on macOS (decided 2026-11-03). Items that only apply to remote hosting, the packaged desktop app, or other operating systems are marked N/A with the reason. See `docs/security-hardening.md` for boundaries, limitations, and evidence. Interview workspace features (Phase 2 onward) have not started.

## Objective

Make LearnHarness an all-in-one environment for React coding, frontend fundamentals, and system design interview preparation. Preserve its adaptive teaching, conversational practice, model connections, durable sessions, and knowledge graph. Implement security improvements before introducing learner code execution.

This document records proposed work and acceptance criteria. It does not claim that vulnerabilities have been exploited or that the application has passed a security audit. The initial review was static: dependencies were not installed, tests were not run, and current dependency advisories were not checked.

## Architectural commitments

- [ ] Extend the existing application; do not create a separate interview app or parallel agent framework.
- [ ] Keep domain contracts in `src/core/`, persistence in `src/store/`, orchestration in `src/server/`, agent behavior in `src/agent/`, transport in `app/api/`, and interface components in `components/`.
- [ ] Reuse the existing practice `problem` → learner submission → `conclude` lifecycle.
- [ ] Reuse chat admission, streaming, cancellation, recovery, model selection, and usage reporting.
- [ ] Keep credentials and privileged operations outside learner code and preview frames.
- [ ] Keep attempt performance separate from the knowledge graph's propositions and reasoning chains.
- [ ] Preserve existing teaching sessions, ordinary conversational practice, and old saved records.
- [ ] Read applicable repository instructions and installed framework documentation before implementation. Resolve design choices and approve an implementation plan for each milestone.

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

## Phase 2 — First complete React practice loop

### 6. Extend practice contracts — medium difficulty

Integration: `src/core/contracts/chat.ts`, `src/core/input-events.ts`, `src/agent/tools/practice.ts`.

- [ ] Define coding exercise metadata: instructions, starter files, supported dependencies, test specification, and review criteria.
- [ ] Define workspace, draft, immutable submission, and execution-result contracts.
- [ ] Link each workspace and submission to its chat and problem occurrence.
- [ ] Keep hidden solutions and private evaluation material outside learner-visible starter files.
- [ ] Validate filenames, file sizes, dependency declarations, and incoming payloads.
- [ ] Preserve existing conversational problem shapes through backward-compatible optional fields or explicit versioning.

Acceptance: existing practice sessions still load and run; coding problems can carry structured workspace data.

### 7. Add the practice workspace interface — medium difficulty

Integration: `components/chat.tsx`, `components/practice-dock.tsx`, existing session state.

- [ ] Add resizable problem/chat, editor, and preview/results panels within practice sessions.
- [ ] Preserve hints, thinking submissions, problem dismissal, and next-problem behavior.
- [ ] Define compact-window layout and accessible keyboard navigation.
- [ ] Scope editor shortcuts so Enter and other typing keys do not accidentally submit the practice answer.
- [ ] Show saving, running, failed, and disconnected states clearly.

Acceptance: the learner can complete a coding exercise without switching applications or losing access to the tutor.

### 8. Embed editor and file management — medium difficulty

- [ ] Select an established editor component after checking licensing, bundle impact, accessibility, and framework compatibility.
- [ ] Support React/TypeScript, JavaScript, HTML, and CSS editing.
- [ ] Add file tabs, file selection, and the agreed file creation/rename/delete behavior.
- [ ] Provide diagnostics supported by the chosen editor/runtime; distinguish them from executed test failures.
- [ ] Keep starter and solution files distinct and protect unfinished drafts from accidental resets.

Acceptance: editing multiple files is stable, keyboard-accessible, and recoverable.

### 9. Add project compilation and live preview — high difficulty

Integration: hardened browser/execution infrastructure and existing artifact presentation patterns.

- [ ] Select a frontend runtime that satisfies Phase 1 isolation requirements.
- [ ] Start with controlled templates and supported dependencies; arbitrary shell commands and backend servers are outside the first milestone.
- [ ] Compile JSX/TypeScript and resolve imports for multi-file exercises.
- [ ] Refresh preview after changes with clear compile/runtime status.
- [ ] Isolate previews from application storage and privileged APIs.
- [ ] Stop or restart failed/running previews without affecting chat state.
- [ ] Verify actual runtime behavior in packaged Electron and browser mode.

Acceptance: a learner can edit a React component and interact with its rendered output inside LearnHarness.

### 10. Capture runtime evidence — medium difficulty

- [ ] Extend the demo bridge approach for console messages and compilation/runtime errors.
- [ ] Associate output with the specific workspace revision and run.
- [ ] Bound and sanitize output to prevent flooding and rendering injection.
- [ ] Distinguish user code logs from authoritative execution status.

Acceptance: errors are visible and attributable to the code revision that produced them.

### 11. Save drafts and submit code — medium–high difficulty

Integration: `src/core/ports.ts`, `src/store/`, `src/server/stores.ts`, chat submission/admission flow.

- [ ] Persist drafts through storage adapters and expose narrow server/API operations.
- [ ] Autosave with visible failure handling; restore files after restart.
- [ ] Create an immutable code snapshot when the learner submits.
- [ ] Attach the explanation and available run evidence to that snapshot.
- [ ] Prevent stale runs or later edits from changing what a submission means.
- [ ] Reuse existing turn admission and recovery rather than adding a second chat engine.
- [ ] Define workspace cleanup when sessions are deleted.

Acceptance: edit → preview → submit → feedback → close → reopen preserves the exact attempt and current draft.

## Phase 3 — Reliable interview evaluation

### 12. Add executable tests — high difficulty

- [ ] Support JavaScript behavior tests and React interaction tests in the isolated runtime.
- [ ] Separate learner code from the trusted result collector as far as the runtime permits.
- [ ] Show passed, failed, timed-out, and infrastructure-error results distinctly.
- [ ] Tie results to a code snapshot and test version.
- [ ] Decide whether tests are visible or hidden; document that client-delivered tests cannot be strongly secret.
- [ ] Prevent user console output from impersonating test results.

Acceptance: feedback uses actual test execution; infrastructure failures are never represented as passing solutions.

### 13. Extend the existing practice agent — medium–high difficulty

Integration: `src/agent/tools/practice.ts`, practice prompts, existing problem/conclusion projections.

- [ ] Provide submitted code and verified results to the existing practitioner.
- [ ] Evaluate correctness, edge cases, accessibility, clarity, and relevant tradeoffs.
- [ ] Separate test-backed observations from model judgment.
- [ ] Treat code comments, logs, and imported content as untrusted evidence, not instructions.
- [ ] Preserve hint and solution-reveal behavior and explicit next-problem progression.
- [ ] Enforce context limits without silently omitting important files or evidence.

Acceptance: the interviewer reviews the submitted implementation, not a stale draft or inferred execution outcome.

### 14. Add interview controls and exercise content — medium–high difficulty

- [ ] Define learning versus interview behavior using existing practice configuration.
- [ ] Add optional timing, hints on request, follow-up questions, and solution reveal controls.
- [ ] Create a small verified set of React, JavaScript, CSS, accessibility, and debugging exercises.
- [ ] Include requirements, starter files, reference implementation, tests, and review criteria for each coding exercise.
- [ ] Validate exercise tests against both correct solutions and representative incorrect solutions.
- [ ] Let generated exercises use the same contracts; clearly distinguish unverified generated tests from curated tests.

Acceptance: at least one exercise in each initial supported category works through the same end-to-end practice system.

## Phase 4 — System design and continued learning

### 15. Add a system design workspace — medium–high difficulty

- [ ] Attach an editable diagram canvas and structured design notes to a practice problem.
- [ ] Support requirements, component responsibilities, data flow, API sketches, and tradeoffs.
- [ ] Save diagram and notes revisions through the same workspace persistence patterns.
- [ ] Submit a stable design snapshot that the existing practitioner can inspect.
- [ ] Support frontend architecture exercises first and explicitly scope broader distributed-system exercises.
- [ ] Review requirements coverage and reasoning rather than claiming one uniquely correct architecture.

Acceptance: the learner can diagram, explain, submit, and discuss a design entirely within the existing practice session.

### 16. Connect attempts to future practice — medium–high difficulty

- [ ] Store attempts, outcomes, hints used, and review evidence separately from knowledge propositions.
- [ ] Link attempt history to relevant existing graph concepts where supported.
- [ ] Use history and graph context to propose targeted teaching and follow-up exercises.
- [ ] Define any change to practice-to-graph extraction explicitly; current practice should not silently start writing performance scores into the graph.
- [ ] Support review and deletion of attempt history.

Acceptance: later sessions can use prior evidence without treating an AI judgment as a certified skill rating.

## Completion and release checklist

- [ ] Run focused security, contract, persistence, runtime, and agent-flow tests.
- [ ] Test restart, refresh, cancellation, failed saves, failed model calls, and interrupted execution.
- [ ] Test old chats and ordinary teaching/practice for regressions.
- [ ] Complete type checking, linting, production build, and platform smoke checks.
- [ ] Verify keyboard access, panel resizing, and editor performance on realistic exercises.
- [ ] Document setup, runtime requirements, dependency support, file permissions, and known limitations.
- [ ] Demonstrate the complete React practice loop and system design loop against acceptance criteria.

## Decisions to resolve before the relevant implementation stage

- [x] Exact folder-grant UX and sensitive-path policy.
- [x] Browser authentication/bootstrap and supported remote-access scope. Local only; no remote access.
- [x] Secure credential storage strategy per supported platform. macOS Keychain only; other platforms N/A.
- [ ] Runtime isolation model and network/dependency policy.
- [ ] Editor/runtime libraries and supported initial templates.
- [ ] Test execution authority and visible/hidden test behavior.
- [ ] Workspace data versioning, retention, and reset behavior.
- [ ] Interview controls, review rubric, and initial exercise categories.
- [ ] Diagram editor and initial system design scope.

## Milestone order

1. Security foundations and verification.
2. One complete saved React exercise with editor, preview, and tutor review.
3. Executable tests, interview controls, and verified exercise library.
4. System design workspace and history-informed learning.

Update this checklist as implementation decisions are approved. Mark items complete only after their acceptance criteria have been verified; record material limitations rather than checking an incomplete item.

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
