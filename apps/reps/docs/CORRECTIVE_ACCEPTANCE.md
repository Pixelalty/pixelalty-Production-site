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
| Canonical hosts | workers.dev browser UI goes to reps/join with safe path; internal API, webhook and asset behavior preserved; credentials removed from visible URLs | Pending updated hosted deployment verification |
| Recruiting privacy | Internal package commissions removed from public UI and public RPC; benefits and earnings disclaimer retained | Pending updated hosted deployment verification |
| Customer site | Native secondary homepage recruiting section, footer link and /apply redirect; focused PR #2 | Pending publishing the tested customer-site change |
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
