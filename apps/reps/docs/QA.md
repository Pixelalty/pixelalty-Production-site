# V1 validation

The latest auth/domain revision is tracked in [AUTH_ACCEPTANCE.md](AUTH_ACCEPTANCE.md). It adds the MFA viewport fix, branded email/callback flows, domain routing and recruiting entry, bringing the automated suite to 64 passing tests. External domain/SMTP setup and real inbox acceptance remain explicit gates; use the [owner setup guide](PIXELALTY_DOMAINS_AND_EMAIL.md).

The release is a staging candidate on `codex/pixelalty-sales-v1`. Production has not been deployed or migrated. Scope follows section 172 of the master requirements; the V1.5/V2/V3 features remain separately scheduled. See [the acceptance ledger](V1_ACCEPTANCE.md).

## Verified locally

- ESLint and TypeScript pass.
- All 52 automated tests pass against the actual SQL migrations, Worker code and workspace navigation/preferences.
- The 5,003-row import case accepts 5,000 records and reports duplicate, DNC and invalid exceptions; repeating commit creates no duplicate records.
- Coverage includes RLS/role/MFA boundaries, approval retries, activation gates, immutable notes, focus sessions, local-day XP caps, follow-up completion, configurable progression, private quiz grading, reviewed imports, metadata preservation and all exact commissions.
- Financial tests cover verified attribution, refunds, disputes, hold/settlement gating, transfer and reversal persistence, bank payouts, and uncertain Checkout/Connect/reversal attempts beyond safe idempotency windows.
- The browser suite runs the actual frontend and Worker with SQL-backed persistence. It covers public application, recruiting approval, settings, content/quiz publication, import, attributed deal/checkout requests, profile/goals, business notes/favorites, focus pause/resume, training and role-specific screens.
- The workspace revision verifies the single owner Home, permission-filtered page search, empty search, cancelable appearance preview, account preference save/failure/retry, pin removal/reordering and persistence after clearing browser storage and signing in again. The owner fixture has no rep profile.
- Settings sections survive reload and browser Back. Recruiting changes persist to SQL. Owner Home, Appearance and Settings are checked at 390/768/1440 px, including the mobile drawer's inert state, Escape/focus return, page search and visible sandbox indicator.
- Chromium walkthroughs at 390, 768 and 1440 pixels have no page overflow, unexpected console errors or failed application API requests. Light/dark screenshots were inspected.
- Vite production build and Wrangler staging dry run pass. The main client bundle has an advisory size warning (about 154 kB compressed).

The integration suite uses local simulations at the Supabase Auth/PostgREST HTTP, email, Turnstile and Stripe boundaries. SQL statements, transactions, functions, RLS and application code are real. A simulated checkout request is not proof of a real payment, email delivery or hosted webhook.

The reviewed [owner Home](images/workspace-home-desktop.png), [mobile Home](images/workspace-home-mobile.png) and [Appearance](images/workspace-appearance.png) screenshots use isolated fixture data. They document the implemented UI, not a signed-in hosted acceptance session.

## Verified in GitHub CI

The [PostgreSQL concurrency run](https://github.com/Pixelalty/pixelalty-Production-site/actions/runs/35942160935) passes all six scenarios against twelve separate connections with a lock barrier. This confirms real request overlap while testing same-rep capacity, competing assignments, call idempotency, duplicate payment events, transfer reservations and concurrent reversal limits. The suite runs all migrations on a fresh PostgreSQL 17 service. No remote application database is used.

The preceding [complete application check](https://github.com/Pixelalty/pixelalty-Production-site/actions/runs/35941349767) also passed lint, types, all 49 tests, production build, Chromium browser acceptance and Wrangler staging dry run.

These linked runs predate the workspace revision. The current revision adds three navigation/preference tests and the browser checks described above; its CI result is recorded on the pull request.

## Staging database

The original five migrations and `sales_v1_completion` / `sales_v1_indexes` are recorded in the dedicated staging project. The completion migration is additive: the original applied files were not edited. Schema grants and RLS are checked separately from user authentication. No fixture users, prospects, calls or financial records are seeded remotely. Direct staging Data API checks return HTTP 200 for public recruiting configuration and HTTP 401 for an anonymous rep-table read.

## Remaining hosted acceptance

- Verify the new branch revision is the deployed staging Worker, inspect its logs and runtime resource limits, and perform a hosted browser walkthrough.
- Use intended test accounts for invitation/reset delivery, MFA, verification, session expiry and role navigation. The local identity provider does not certify Supabase Auth/SMTP configuration.
- Exercise real Turnstile and a hosted large import, including interrupted upload recovery.
- Complete Stripe sandbox Checkout for all packages, higher Advanced pricing, Connect onboarding, settlement, transfers, refunds/disputes, reversals and bank payout events. Verify duplicate and out-of-order webhook processing.
- Publish the business-approved agreement and verify the business's classification, tax, payout and calling policies. The application does not invent or approve these documents.
- Confirm cron delivery, monitoring and backup/restore procedures under the actual hosting plan.

Keep the pull request in draft and do not enable production DNS or live payments until these gates have evidence. No hosted gate is marked complete using a provider simulation.

## Reproduce concurrency checks

`npm run test:concurrency` requires `PIXELALTY_TEST_DATABASE_URL` pointing to a fresh local PostgreSQL database named `pixelalty_test`. The script refuses remote hosts and nonempty databases. CI provisions its own PostgreSQL 17 service; no Supabase database is used by this test. Role and Auth claim fixtures are isolated to that disposable cluster.
