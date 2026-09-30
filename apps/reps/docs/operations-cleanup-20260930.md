# Operations cleanup — 2026-09-30

Base: staging branch `codex/pixelalty-sales-v1` at
`8f89145a5845c11664cfc118bbda3af2dc4262ce`. Existing infrastructure and visual
design are preserved. The only authorized database is staging
`bqycqmiaacoeulotjyrv`; production is excluded.

## Changes

- Retire Admin Training & Content and My Team navigation. Legacy routes lead to
  Essentials and Rep Management. Agreement publishing has its own owner-only Admin
  page, including the existing onboarding links. Existing curriculum/history remains intact.
- Version the existing package catalog through Admin Sales Settings. Prices,
  commissions, visibility, starts-at labels and names are editable; stable tier
  ordering does not depend on names. Existing deal/payment snapshots remain
  immutable. Delayed payment webhooks use the catalog effective at payment time
  (Stripe timestamps have second precision). External payment links must be
  updated separately when customer prices change.
- Store support cards in the existing settings record. Admin can edit, add,
  hide, restore, reorder and delete cards and replace/remove QR images. Uploads
  reuse the private profile-media bucket; transactional retirement prevents a
  card save racing image cleanup. The existing scheduler retries orphan cleanup.
- Remove deleted reps from operational lists and expose historical accounts
  separately. Existing session/auth revocation remains in place; recordings
  now count as protected history. Canonical person links connect recruiting,
  support, recordings, financial tables and rep management.
- Read ordinary namespace-prefixed XLSX files correctly. The supplied workbook
  exposed ExcelJS's unprefixed-workbook assumption (`reading 'sheets'`). The new
  bounded, namespace-aware value reader rejects formulas/external relationships
  and uses the same normalization as CSV/TSV.
- Automatically map the 23 standard headers, normalize optional values and infer
  IANA timezones from a bundled ZIP/city dataset. Unknown or conflicting locations
  fail only the affected row. No paid service or infrastructure is added.
- Add the shared available-lead pool, inspection and atomic selected-lead claims
  with capacity serialization. Manual assignment remains an administrative override.
- Add actual single/bulk permanent deletion and separate archiving. Ordinary
  leads and spreadsheet copies are removed; financial/compliance/recording
  evidence is protected and hidden from normal CRM. Deletion receipts make
  retries idempotent. Select All applies to the current page.
- Permit the configured private-media origin in the existing CSP so inline
  recording playback can load signed audio. Download stays separate; playback
  URLs last long enough for a 50-minute recording. Storage remains private.
- Record redacted internal error causes, action and safe request metadata in
  Admin diagnostics. Request `b4106531-706c-401a-8b69-16267f6a4422` had no
  original cause detail; the exact workbook reproduced its failing path locally.

## Exact workbook

Source: `Demo_Business_Lead_Spreadsheet(2).xlsx`, 10,844 bytes, 23 headers,
25 business rows. Repository fixture: `tests/fixtures/demo-business-leads.xlsx`.
SHA-256: `134b4f7cb585e21e89262a55d350c1be16b4779dc95f3cece61b9d370b5b0179`.
The original uploaded file was not modified.

Targeted SQL tests stage/commit all 25 rows without manual timezone selection,
then verify duplicate-safe retry, claim exclusivity, protected and ordinary
deletion, separate archiving, denied rep administration, account revocation,
dynamic settings and diagnostic isolation. CSV/TSV exports produce identical
normalized data. Additional PostgreSQL concurrency tests race selected claims
across reps and against a single rep's remaining capacity.

## Validation boundary

Pre-commit targeted operations/payment run: 26 passing tests. Lint and TypeScript
passed during implementation. Final regression is run by the existing PR workflow:
unit/integration/RLS tests, PostgreSQL concurrency, six browser suites, production
build and staging Worker dry run. Browser suites exercise the real UI/Worker/SQL
with explicitly simulated external providers; they do not count as hosted acceptance.

Migrations:

- `20260930030650_operations_cleanup.sql`, applied only to staging as remote
  version `20260930041239` after the full passing regression.
- `20260930041804_consolidate_rep_read_policy.sql`, a follow-up preserving the
  existing self/team/Admin/Finance read access in a single permissive policy.
  Session and MFA restrictions remain separate and unchanged. This removes the
  new multiple-permissive-policies advisor warning without changing permissions.
  Applied only to staging as remote version `20260930042017`; the subsequent
  performance advisor has no warnings. The targeted database/operations run
  passed all 32 tests, including direct rep isolation and Finance directory reads.

No previously applied migration was edited. The private deletion-receipt table
intentionally has no user policies or user grants (deny by default).

Hosted acceptance still requires the authorized Admin and ordinary rep sessions.
Do not use chat-supplied passwords or bypass MFA/bot checks. Preserve recording
`d0363afd-9773-4f43-bfd8-6b9a8f682a5c` and unrelated data. Import the exact workbook
through Admin, verify the rep claim/note flow, archive one disposable row, delete
three selected disposable rows, and report the actual remaining counts. Record
the merged commit, deployed revision and hosted results separately; do not label
unperformed hosted checks as passing.

First final regression (PR #13, Actions run 36665993757): 128 unit/integration
tests and 14 PostgreSQL concurrency tests passed. Auth, profile, branding and
manual finance browser suites passed. The main browser suite completed the new
package/support/import/claim/delete/playback flows, then caught a stale-data crash
opening deleted-account history; the onboarding suite caught the removed agreement
publishing link. Both root causes were corrected, along with a deleted-profile
request, catalog ordering and mobile lead-table readability found in visual review.
The required gate is rerun on the corrected commit before deployment.

Full corrected regression: commit `072a5845646a636f363f9958167c616a5ee2e25c`,
Actions run `36667245680`, job `109734499491`, all successful:

- Lint, TypeScript and production build.
- 128 unit/integration/SQL/RLS tests.
- 14 PostgreSQL 17 concurrency tests, including simultaneous selected-lead
  claims, one-rep capacity races and financial retry/idempotency checks.
- All six browser suites: V1, Auth, Profile, Onboarding, Branding, Manual Finance.
- Staging Worker packaging/dry run.

Visual review includes the exact-workbook preview, rep claim detail, mobile lead
table at 390px, tablet/desktop layouts and light/dark MFA screens. The disposable
browser fixture imported 25 demo rows, deleted three, archived one and retained
22. These are fixture results, not hosted staging data. Staging had zero business
rows immediately after migration and the preserved recording was still ready.

## Hosted verification and search correction

PR #13 merged as `2f167279f39e6d9d17ad79408ae63460bed511ce`. Cloudflare staging
build `786056bc-8db0-439e-bad7-a2ed9f89cbc8` deployed Worker version
`4f5f3adb-54ac-45e2-8cea-b6840bfa886c`; browser assets matched the tested build.
The final pre-merge workflow `36668485348` passed the same 128 application tests,
14 concurrency tests, all six browser suites, build, lint, types and packaging.

Actual hosted Admin verification used secure sign-in and the original workbook:
25 accepted, zero rejected/duplicates/DNC exceptions, batch
`2b97f3c5-dd31-4d0a-8109-585bdac3fc0f`. Single deletion removed
Example Towing & Recovery; bulk deletion removed Demo Remodeling Group and
Placeholder Junk Removal. Sample Window & Door was archived separately.
The database retained 22 demo businesses, one archived. The preserved recording
played without a media error; pause, seeking and speed controls worked. Its
separate download produced a valid 555,529-byte WebM, SHA-256
`a7509beef55686965218e40545dca0318a1d8739d72345c727dd17f496a25eb2`.
A temporary Launch commission change persisted across reload, then the original
$125 amount was restored with a new prospective version.

Hosted testing found full-name search silently stripped punctuation such as `&`.
The correction retains the entered name, quotes PostgREST filter values and
escapes SQL LIKE wildcards. The regression uses the real Worker and migrated SQL
to verify punctuation, quoted names, literal wildcards, injection-shaped text and
RLS. The browser regression now searches the full demo name. Review rows are
labelled "Data row" to distinguish their one-based numbering from worksheet
line numbers. This verified hosted defect requires a corrective staging release;
no additional database migration or infrastructure is involved.
