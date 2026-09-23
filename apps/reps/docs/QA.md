# Validation and remaining acceptance

Status: staging candidate. No production database writes, invitations, live payments, transfers, DNS changes or deployments have been performed. GitHub source checkpoints are on `codex/pixelalty-sales-v1`.

## Local checks

On 2026-09-23, `npm run check` passed: ESLint, TypeScript, all 33 automated tests and the Vite production build. `npx wrangler deploy --dry-run --env staging` also completed successfully without deployment. Hosted acceptance remains unverified.

The automated suite covers real migration application in PGlite, RLS/grants, rep separation, administrator MFA, private HR boundaries, private quiz keys, onboarding gates, approval retry behavior, claim capacity, idempotent call XP, DNC, future follow-ups, all four exact commissions, immutable pricing, payment attribution, holds, refunds/recovery review, transfer/reversal idempotency, persistent provider retry guards, CSV/XLSX parsing and Worker auth/webhook boundaries.

The import case stages 5,003 rows: 5,000 accepted, one duplicate, one suppressed number and one invalid row rejected. Repeating the completed commit preserves the counts. This verifies database behavior in an isolated process, not hosted import latency or Cloudflare limits.

## Unverified hosted gates

- Apply all migrations to a dedicated Supabase staging project, then exercise actual Auth JWTs and PostgREST through the Worker. The local harness simulates Supabase's Auth functions; it does not test the gateway.
- Run concurrent claims and financial retries on a full Postgres server with separate connections. PGlite tests logical capacity and deduplication, not true multi-connection races.
- Review desktop, tablet and mobile layouts, keyboard/focus behavior, dark/system themes, empty/error/loading states, row pagination, and all role-specific navigation in a supported browser. No browser screenshots were captured: local Chromium crashed, and the supported remote browser could not access the local preview.
- Verify owner MFA setup, invitation acceptance, email delivery, recovery links, session expiry, sign-out and reauthentication using intended test accounts. Test support/finance/content/manager access as separate users.
- Submit recruiting with real Turnstile, approve a test applicant, complete required content/agreement, verify classification and activate the test rep. Verify duplicate and rate-limit behavior.
- Run a real 5,000-row CSV and XLSX import through the hosted Worker; measure memory, CPU, request limits, resumability and error downloads. The 25,000-row maximum requires a hosting plan with sufficient subrequest capacity.
- Complete sandbox Checkout for every package, including a higher Advanced price. Deliver duplicate/out-of-order events, signature failures, delayed settlement, partial/full refunds and dispute updates. Confirm exactly one commission and fulfillment record per paid deal.
- Complete Express onboarding in the platform's supported countries; validate restricted/unready accounts, eligible transfer, lost response reconciliation, partial/full reversal, bank payout paid/failed states, and insufficient platform funds. These tests have not contacted Stripe yet.
- Verify cron scheduling, backlog visibility, provider replay, owner health view, sensitive log redaction, backup and restoration procedures.
- Reconcile the finished UI against the full original master specification before calling the product complete. Review launch content, business-provided agreements and calling configuration with the owner.

## Known follow-ups

- `sale_progression` failure jobs are recorded but need an automated retry processor or an approved operational repair procedure before launch.
- Admin rep selectors currently load the first page of reps; searchable selection and team management UI need completion before larger team rollout.
- Interrupted import staging can leave an incomplete batch. Commit retries are safe, but resume/restart staging UX needs hosted acceptance.
- Expired provider attempts with no discoverable provider object require a reviewed repair; there is no unsafe blind reset button.
- The browser fixture script is unverified. It is test-only, has no production bypass and is excluded from the app bundle.
- Future automated dialing, recording, AI coaching, outbound messaging and cash competitions remain disabled/unimplemented.

The draft pull request must stay unmerged until the owner has a reviewable hosted result and the relevant gates above have evidence.
