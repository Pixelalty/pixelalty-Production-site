# Critical V1 corrective pass — September 24, 2026

This is a staging candidate. A passing isolated test does not certify inbox delivery, human tax/legal review, Connect onboarding, or a real sandbox payment/webhook. Customer production Supabase is not a target.

| Requirement | Implementation and regression coverage | Hosted acceptance |
| --- | --- | --- |
| Actionable checklist | Required incomplete steps identify rep actions or Pixelalty review; working deep links; in-place status polling | Pending real account walkthrough |
| Required agreement | Owner publishes immutable versions; rep reads and signs exact version; acceptance persists and is audited | Blocked until owner supplies approved agreement content |
| Classification | Owner/Sales Admin review with MFA, reason and visible audit history; rep cannot self-select; Finance controls employee tax/payroll verification | Owner business decision required |
| Secure signed-PDF W-9 | Private bucket; bounded PDF structural validation; no extracted tax IDs or original filename; only MFA Owner/Finance downloads; on-demand authorized response, never public/signed object URLs | Pending approved test document and Finance review |
| Document lifecycle | Submitted, under review, verified, needs correction; correction notification; replacement/archival revokes verification; append-only upload/download/review/history audit | Pending real upload/review |
| Payout setup | Contractor starts actual Connect account-link flow; return refresh and webhook-driven status; explicit classification blockers | Pending real Stripe sandbox completion |
| Activation and operations | Explicit missing-gate actions, activation enabled only when real gates pass; overview of applicants, reps, tax queue, failed email and payment events | Pending real account activation |
| Canonical hosts | workers.dev browser UI goes to reps/join with safe path; internal API, webhook and asset behavior preserved; credentials removed from visible URLs | Verified internal /admin/recruiting opens https://reps.pixelalty.com/admin/recruiting and requires sign-in |
| Recruiting privacy | Internal package commissions removed from public UI and public RPC; benefits and earnings disclaimer retained | Verified updated benefits UI at join.pixelalty.com and staging public RPC returns no package data |
| Customer site | Native secondary homepage recruiting section, footer link and /apply redirect; focused PR #2 | PR #2 merged as 1792bac6; Cloudflare Pages passed; live homepage button and /apply both verified reaching join.pixelalty.com |
| Test indicator | Subtle “Test environment” for admin roles only; ordinary reps see no test badge | Pending updated hosted deployment verification |

## Secure document operation

Use `https://www.irs.gov/pub/irs-pdf/fw9.pdf` for the current official form. The current IRS interactive PDF includes XFA, scripts and embedded content. Complete and sign the applicable form, then use Print → Save as PDF and confirm that all entries and the signature are visible. Submit that PDF (maximum 5 MiB, 20 pages). The Worker never rewrites signed bytes, extracts form fields, stores original filenames, or claims to validate taxpayer IDs with the IRS.

Document bytes live only in the private `pixelalty-tax-documents` Storage bucket. Application tables contain generated object keys, byte count, digest, statuses and audit metadata. A restrictive Storage policy prevents unrelated permissive policies from exposing this bucket. Reps can upload their own document and see its status, but cannot download any stored tax PDF. Only Owner/Finance with MFA can request a document download. The Worker checks role/assurance on each request and records the access. Archive preserves restricted history; permanent deletion/retention is a separate owner-approved policy and is not automated.

Classification changes archive the current document and reset verification. Replacements are new immutable objects and require fresh review. Downloads are attachments with no-store, nosniff and a restrictive sandbox policy. PDF validation rejects active content, embedded files, encrypted and malformed PDFs; this is not an antivirus service or electronic substitute W-9 implementation.

## Test boundaries

- `npm run check`: lint, type checks, unit tests, migrated SQL, Worker integration and frontend production build.
- `npm run test:concurrency`: real PostgreSQL 17 with simultaneous connections and explicit lock barriers, including tax finalization and stale review/replacement races.
- `npm run test:onboarding`: actual React screens, Worker and SQL; isolated provider transports cover rep/Admin classification, agreement publication/acceptance, invalid/valid PDF, correction, replacement, download/review, Connect callback, training, activation, persistence and responsive screenshots.
- Existing V1, auth/MFA and customer-site branding browser suites remain required. Artifacts are retained by CI for review.

Do not mark hosted acceptance complete based on these isolated transports. Keep Stripe test mode. The final hosted sequence still requires the owner’s approved agreement, authorized tax/classification review, a user-controlled test inbox and sign-in, Stripe sandbox setup/payment, actual webhook delivery, one correct commission, and state after a fresh sign-in.

## Migration scope

`20260924140417_sales_secure_tax_onboarding.sql` is additive and targets only staging project `bqycqmiaacoeulotjyrv`. Preserve the remote migration version mapping when recorded. Never reapply previously completed migrations or point this deployment at the customer production database.

### Recorded staging application

Applied on September 24: remote migration version `20260924144253` maps to `20260924140417_sales_secure_tax_onboarding.sql`. Verified the private bucket, 5 MiB/PDF limits, restrictive object policy, empty tax-document table, and commission-free public RPC. Existing reps, classifications and legal content were not changed.

Remote version `20260924145448` maps to `20260924145303_sales_recruiting_compatibility.sql`. A hosted rollout check caught the preceding frontend calling `packages.map()` before the new frontend was deployed. The public response now retains an empty `packages: []` for compatibility, with no commission or package information. The new frontend is also deployed and was checked on the owned domain.

The security advisor reports informational deny-by-default RLS on private helper tables (intentional) and an existing [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) that is disabled. Review that Auth setting for release; no paid plan change was made. The performance advisor reports unused indexes only; workload indexes are retained.

## Recorded automated verification

Commit `7e8267496caf1653df80d7dccfefb43f60c7bd03` passed [CI run 36015373723](https://github.com/Pixelalty/pixelalty-Production-site/actions/runs/36015373723): lint, type checks, 74 unit/SQL/Worker integration tests, production build, PostgreSQL 17 contention checks, all four browser suites, and Worker deployment dry run. Browser evidence is retained in the run artifact. MFA screenshots show viewport-filling backgrounds. Responsive onboarding screenshots identified final spacing fixes and a need to wait for navigation/resize to settle; the follow-up includes explicit mobile sidebar assertions and a rerun.

Commit `42e8c851a84b261637311aa1d6d0c4cc93e7b851` passed [CI run 36017134652](https://github.com/Pixelalty/pixelalty-Production-site/actions/runs/36017134652): 74 tests, 9 PostgreSQL concurrency checks, all four browser suites, lint, type checks, build and Worker dry run. The final mobile/tablet/desktop onboarding screenshots were reviewed; mobile drawers are correctly hidden. The hosted invitation-error page shows the branded recovery state and removes the error fragment from the address.

The first secure owner sign-in handoff reached a session error before a usable authenticated workspace could be verified. Staging operational logs confirm successful password authentication, MFA verification and context RPCs; the visible error was a later Worker request without a session header. Follow-up code treats a current 401 as an ended session, returns to the sign-in form, and prevents stale workspace responses or initial session restoration from overwriting a newer auth state. Browser regressions exercise a real Worker missing-header response, delayed responses across MFA/sign-out, and successful sign-in afterward. This does not count as successful hosted owner acceptance.

At the final staging data check, there were three onboarding reps with unreviewed classifications, zero required agreements, eleven required lessons, one required quiz, and zero uploaded tax documents. The owner must supply approved agreement content and business/classification decisions; no legal document, tax evidence, or business approval was fabricated.

These results cover isolated provider transports, not real inbox delivery, Connect identity setup, hosted Checkout, or hosted webhook delivery. Those acceptance items remain open until exercised with the owner-controlled test account and approved business/legal inputs.
