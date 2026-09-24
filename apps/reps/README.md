# Pixelalty Sales

CRM and rep portal intended for `reps.pixelalty.com`. This branch contains a staging candidate, not a production release. The original five migrations and the additive V1 completion/index migrations are applied to the dedicated staging project. See [staging status](docs/STAGING_STATUS.md) for the exact target, migration mapping and verified boundaries. No production database changes or live payments have been performed.

Start with [the step-by-step account setup](docs/SETUP_STEP_BY_STEP.md). See [validation status](docs/QA.md) and [operations](docs/OPERATIONS.md) before launch.

The existing customer website stays at the repository root. This application has its own build, runtime configuration, and additive database migrations in `apps/reps`. Its source can later move to a dedicated repository without changing its internal paths.

## Implemented workflows

- Public recruiting with Turnstile; administrative review, invitation and gated rep onboarding.
- Supabase authentication, administrator MFA, database roles, team scope and row-level security.
- Lead import, validation, duplicate/DNC rejection, claim capacity, ownership expiry, focus calling, append-only call history and timezone-aware follow-ups.
- Server-priced deals, Stripe Checkout, verified payment attribution, separate commission/transfer/bank payout ledgers, holds and refund/dispute recovery.
- Contractor Connect onboarding, explicit finance transfers, persisted reversal requests and reconciliation controls.
- Academy, private quiz answer keys, versioned agreements, support, fulfillment, notifications, XP and leaderboard.
- Administrative recruiting, rep access, finance, compliance, content, reporting, audit and health views.

Calling starts disabled. Automatic transfers are disabled. Legal agreements are supplied by the business owner. Employee payroll is handled outside Stripe Connect. No customer, rep, earnings or lead demo records are seeded into a real database.

| Package  | Default customer price | Default commission |
| -------- | ---------------------: | -----------------: |
| Launch   |                   $799 |               $125 |
| Growth   |                 $1,299 |               $250 |
| Premium  |                 $1,999 |               $400 |
| Advanced |         $2,999 minimum |               $600 |

Amounts are integer USD cents. Each deal preserves its package version and commission snapshot. An increased Advanced price does not automatically change the $600 commission. Later package edits affect new deals only.

## Development

Use Node 24 and the committed lockfile:

```sh
cd apps/reps
npm ci
npm run check
npx wrangler deploy --dry-run --env staging
```

`npm run check` runs lint, TypeScript, isolated database/Worker tests and the frontend build. PGlite applies the real migrations with test-only Auth roles and records. It does not contact the connected project.

For a full local app, copy `.env.example` to the ignored `.dev.vars`, use a dedicated test database and sandbox credentials, run `npm run build`, then `npm run preview`. Set `APP_URL` to the exact origin printed by Wrangler. Vite alone serves the frontend; it does not provide the Worker API.

Run `npx playwright install chromium` once, then `npm run test:e2e` after the build. The suite starts the production Worker and frontend against a migrated, isolated PGlite database. It exercises forms, approvals, imports, real SQL persistence, settings, deals, focus sessions and training at mobile/tablet/desktop sizes. Identity, email, Turnstile and Stripe boundaries are explicitly simulated in the test process. This does not certify hosted provider configuration. `PIXELALTY_CHROMIUM_PATH` and `PIXELALTY_CHROMIUM_ARGS` optionally select an installed test browser. Screenshots and results are written to ignored `test-results/v1/`.

## Architecture

React/Vite assets and the TypeScript API run in one Cloudflare Worker. The browser receives only public Supabase/Turnstile configuration. The server verifies access tokens through Supabase Auth and executes user RPCs under the user's JWT. Database policies remain the read authorization boundary.

Exposed tables use a `px_` prefix. Private helpers and quiz keys live in `px_private`. Clients cannot write tables directly. Checked RPCs perform mutations; provider reconciliation uses a separate service-only RPC. Financial updates have unique provider identifiers and append-only event histories. Webhook signatures are verified against the raw body before retrieving current Stripe objects.

The staging cron runs every 15 minutes for ownership expiry, follow-up reminders, commission eligibility and bounded payment reconciliation. It does not automatically transfer money.

## Release status

The full master specification is not yet accepted end to end. Hosted browser, real Supabase Auth/PostgREST, concurrent database operations, email, Stripe Connect/webhooks and deployment limits remain staging gates. See `docs/QA.md`. Keep the pull request in draft until acceptance is complete.
