# Run 07 — Red-Team Security Suite, Audit Doc & Submission Kit

Parent state: Run 06 complete (148/148 tests, 72/72 regression runs,
5 SVGs committed; local `122c0f2` awaiting owner-terminal push).
Final pre-submission lock: a scoped security review + adversarial
test suite + audit document, plus the ready-to-paste Devpost package
and the beat-timed voiceover script. No working flow was altered
except one 4-line hardening fix (below).

## 1. Skill & sub-agent mapping

- `security-audit` SKILL.md (guidance mode) + 6 companions
  (`WEB-PROTOCOL-AND-AUTH`, `CLIENT-SIDE`,
  `DATA-ISOLATION-AND-LIFECYCLE`, `RESOURCE-EXHAUSTION-AND-AVAILABILITY`,
  `AI-AND-LLM`, `PROTOCOLS-RPC-AND-MESSAGING`) → finding bar
  (boundary + result required), the `needs_validation` discipline,
  and the per-domain checklists behind §4 of `SECURITY_AUDIT.md`.
  Explicitly a scoped review, not the 6-phase workflow — recorded as
  such in the audit doc.
- `02-extractor-and-paypal` → disputeId URL-interpolation trace that
  produced hardening H-1.
- `03-sdk-cli-mcp` → MCP stdin boundary review (key-material
  rejection, allowlisted dispatch).
- `05-security-and-benchmark` → red-team suite placement + honest
  rate-limit/CSP `needs_validation` notes.

## 2. What was built

### 2.1 Audit + one hardening fix

- Reviewed all 16 workbench routes (prompt said 12 — the tree has 16;
  the doc records the real count), 3 HTML templates, `mcp-server`,
  and `paypal-client` (orders/disputes/webhooks/oauth).
- **H-1 fixed:** `handleDisputeAction` accepted any non-empty
  `disputeId`, later interpolated raw into live PayPal URL paths
  (dot-segment normalizing `new URL`). Impact was bounded (pinned
  sandbox host, GET-first + HATEOAS-parse gate, caller's own
  credential — never a confirmed exploitable finding), but the route
  now enforces the orderId token allowlist (`/^[A-Za-z0-9_-]+$/`).
  Legit `PP-D-*` flows byte-identical.
- Verified controls: 1MB/413 both transports, JSON-shape 400, no
  deep-merge pollution gadget, `esc()` + `<`-free popup JSON,
  origin-locked `postMessage`, pre-transport evidence caps, redacted
  PayPal errors, sandbox-host pinning, MCP key rejection, CSRF N/A
  (no ambient credentials by design).

### 2.2 Red-team suite (`workbench/test/security.test.ts`, 8/8)

Script payloads in mandates (inert JSON round-trip), script tokens
(400, zero reflection), dispute-note data-minimization (stored, only
`evidenceCount` echoed) + 2000-char cap, 6 hostile `disputeId` shapes
(400), >1MB bodies (413, server healthy after), `__proto__` + 5
malformed-JSON shapes (handled, prototype untouched), 5 canary
secrets × 13 routes/error paths (zero leakage), UI bundle (`esc`
present, no secret names).

### 2.3 Submission kit

- `docs/SECURITY_AUDIT.md` — threat model, 3-key isolation, 13-rule
  DOM defense, H-1, verified controls, 4 `needs_validation` notes,
  test results.
- `docs/DEVPOST_SUBMISSION.md` — title + 125-char tagline, receipts
  strip from the committed JSON with marked live placeholders, full
  story (3 arXiv + AP2 inspiration, ladder/flow/auditor/verifier,
  8-package build, 156/156 + JCS-parity + 72-run verification, §7
  honesty), Built With tags, 5 sponsor alignments.
- `docs/VIDEO_VOICEOVER_SCRIPT.md` — 5 tour-synced sections,
  **328** spoken words (≈131s @150wpm), zero crypto acronyms
  (machine-verified both).

## 3. Self-corrections

- Red-team HATEOAS lesson: `provide-evidence` 409s until
  `require-evidence` advertises it — the test now walks the chain,
  and the cap probe uses the second seeded dispute (fresh chain).
- `DisputeRecord` exposes `evidenceCount`, not note bodies — the
  test asserts the stronger property (payload never reflected).
- Voiceover drafted at 337 words → trimmed 9 (verified 328);
  tagline re-measured at 125 chars (doc corrected from my 139 draft).

## 4. Verification (Rule-1 gate, verbatim tail)

- `npm run lint` → exit 0. `npm run typecheck` → exit 0.
  `npm run build` → exit 0. `npm test` → 9 files, **156/156 passed**
  (+8 red-team; 72/72 regression intact).
- Report timestamp churn reverted; receipts untouched; no strays.
- Counts in `SECURITY_AUDIT.md` / `DEVPOST_SUBMISSION.md` (156/156)
  match the observed gate output.

## 5. Files changed

Modified: `packages/workbench/src/routes.ts` (+4/−2: disputeId
allowlist). New: `packages/workbench/test/security.test.ts`,
`docs/SECURITY_AUDIT.md`, `docs/DEVPOST_SUBMISSION.md`,
`docs/VIDEO_VOICEOVER_SCRIPT.md`,
`docs/agent-runs/07-security-audit-and-submission-kit.md`.

## 6. Risks & follow-ups

- Push deliberately NOT done (Part 4 requests commit only):
  `122c0f2` + this commit both await `git push origin main` from an
  authenticated terminal (sandbox has no GitHub credentials).
- `demo:record` still needs a host run for the sub-140s video.
- Live `checkoutnow` shape + live receipts await the SMS cooldown.
