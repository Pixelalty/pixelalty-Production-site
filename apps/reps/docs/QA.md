# V1 validation

The release is a staging candidate on `codex/pixelalty-sales-v1`. Production has not been deployed or migrated. Scope follows section 172 of the master requirements; the V1.5/V2/V3 features remain separately scheduled. See [the acceptance ledger](V1_ACCEPTANCE.md).

## Verified locally

- ESLint and TypeScript pass.
- All 49 automated tests pass against the actual SQL migrations and Worker code.
- The 5,003-row import case accepts 5,000 records and reports duplicate, DNC and invalid exceptions; repeating commit creates no duplicate records.
- Coverage includes RLS/role/MFA boundaries, approval retries, activation gates, immutable notes, focus sessions, local-day XP caps, follow-up completion, configurable progression, private quiz grading, reviewed imports, metadata preservation and all exact commissions.
- Financial tests cover verified attribution, refunds, disputes, hold/settlement gating, transfer and reversal persistence, bank payouts, and uncertain Checkout/Connect/reversal attempts beyond safe idempotency windows.
- The browser suite runs the actual frontend and Worker with SQL-backed persistence. It covers public application, recruiting approval, settings, content/quiz publication, import, attributed deal/checkout requests, profile/goals, business notes/favorites, focus pause/resume, training and role-specific screens.
- Chromium walkthroughs at 390, 768 and 1440 pixels have no page overflow, console errors or failed application API requests. Light/dark screenshots were inspected.
- Vite production build and Wrangler staging dry run pass. The main client bundle has an advisory size warning (about 149 kB compressed).

The integration suite uses local simulations at the Supabase Auth/PostgREST HTTP, email, Turnstile and Stripe boundaries. SQL statements, transactions, functions, RLS and application code are real. A simulated checkout request is not proof of a real payment, email delivery or hosted webhook.

## Staging database

The original five migrations and `sales_v1_completion` / `sales_v1_indexes` are recorded in the dedicated staging project. The completion migration is additive: the original applied files were not edited. Schema grants and RLS are checked separately from user authentication. No fixture users, prospects, calls or financial records are seeded remotely.

## Remaining hosted acceptance

- Verify the new branch revision is the deployed staging Worker, inspect its logs and runtime resource limits, and perform a hosted browser walkthrough.
- Use intended test accounts for invitation/reset delivery, MFA, verification, session expiry and role navigation. The local identity provider does not certify Supabase Auth/SMTP configuration.
- Exercise real Turnstile and a hosted large import, including interrupted upload recovery.
- Run separate-connection claims and financial retries on full Postgres; PGlite proves transaction logic but cannot model multi-connection contention.
- Complete Stripe sandbox Checkout for all packages, higher Advanced pricing, Connect onboarding, settlement, transfers, refunds/disputes, reversals and bank payout events. Verify duplicate and out-of-order webhook processing.
- Publish the business-approved agreement and verify the business's classification, tax, payout and calling policies. The application does not invent or approve these documents.
- Confirm cron delivery, monitoring and backup/restore procedures under the actual hosting plan.

Keep the pull request in draft and do not enable production DNS or live payments until these gates have evidence. No hosted gate is marked complete using a provider simulation.
