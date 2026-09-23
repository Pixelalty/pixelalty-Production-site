# Staging setup status — 2026-09-23

Target: `pixelalty-sales-staging`, project reference `bqycqmiaacoeulotjyrv`, PostgreSQL 17.6.1.166, region `us-west-2`.

Worker: https://pixelalty-sales-staging.elore-marketing.workers.dev

The user reported that the Worker, runtime variables/secrets, Stripe sandbox, Connect, both webhook destinations and Turnstile are configured and deployed. Those provider settings have not yet been verified end to end by this work.

## Migrations applied

All five existing migration files were applied unchanged, in their existing order, exclusively to this staging project. The project had no sales schema and no migration history before application. Each application returned success, and the final history contains the following five entries.

| Source file                                  | Staging history version | Name                      |
| -------------------------------------------- | ----------------------- | ------------------------- |
| `20260923194418_sales_core.sql`              | `20260923230026`        | `sales_core`              |
| `20260923194739_sales_workflows.sql`         | `20260923230036`        | `sales_workflows`         |
| `20260923195131_sales_payments.sql`          | `20260923230048`        | `sales_payments`          |
| `20260923195418_sales_content_reporting.sql` | `20260923230059`        | `sales_content_reporting` |
| `20260923202830_sales_retry_guards.sql`      | `20260923230109`        | `sales_retry_guards`      |

The Supabase migration tool assigns its own history timestamps. Preserve this mapping: do not blindly push the original files again with the CLI. Reconcile migration history explicitly before switching deployment mechanisms. Applied files must remain immutable; future schema changes need new migrations.

The source was verified against branch commit `1ff22e4b2571e3dcae1dca346f7afc642564efba`. Its migration files match the previously checked implementation commit `593c1a5fe7a01c55af217abad086105ab388b04d`.

| Source file                                  | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `20260923194418_sales_core.sql`              | `f4bca972d758d254902e4b1ace7da018e202acf9fd1cbe3b6236d5c2315fca74` |
| `20260923194739_sales_workflows.sql`         | `160d78644904a850e5e3249c784ce67721e9852030c5ae61d8d34d41170e1692` |
| `20260923195131_sales_payments.sql`          | `8dec16c355646acbe937a234a4dd4cb22ecad664fdc3a5a30efb58f1bab1c0c1` |
| `20260923195418_sales_content_reporting.sql` | `bb89913f3d8874bdf360770326bc2c9535ab3c7e414b2d8bed401d2553db6352` |
| `20260923202830_sales_retry_guards.sql`      | `0aa17d71f3301d174553f6418b9099e70098872053747e2e34c271254952ebe5` |

## Verification completed

- All 34 exposed sales tables have RLS enabled. Authenticated clients have no direct INSERT/UPDATE/DELETE/TRUNCATE grants.
- The service RPC is executable by `service_role`, not by `anon` or `authenticated`.
- Public RPC wrappers are security invoker. Private privileged functions have fixed empty search paths. Authenticated clients cannot read quiz answer keys.
- Supabase security advisors reported no warning/error findings. Two informational notices identify RLS without policies on `px_private.quiz_keys` and `px_private.rate_limits`; deny-by-default access is intentional for these internal tables. Do not add public policies to silence these notices. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- All four default price/commission pairs are correct: 79900/12500, 129900/25000, 199900/40000 and 299900/60000 USD cents.
- Seed content contains 11 lessons, one readiness quiz, five scripts and one knowledge entry. No business-provided agreement, user, lead or financial demo records were seeded.
- Calling and automatic transfers remain disabled. Agreement, tax and payout gates remain enabled.
- Anonymous public-config RPC works through the actual Supabase REST API (HTTP 200). Anonymous rep-table reads and service RPC execution are rejected (HTTP 401, SQLSTATE 42501).
- A service-role `tick` invocation succeeds on real PostgreSQL inside a transaction that is rolled back; this verifies database execution, not the deployed Cron trigger or its secret binding.
- Auth's public settings endpoint responds. Email auth is enabled, automatic email confirmation is disabled and anonymous sign-in is disabled.

## Next setup dependency

There are zero Auth users and zero assigned administrative roles. The owner needs to create their own staging login in Authentication → Users → Add user → Create new user, using their chosen email/password. Auto Confirm User is appropriate for this manually provisioned staging owner. Return only that account's email or UUID so the owner role can be assigned to the intended identity. Passwords and MFA codes stay private.

Cloudflare returned HTTP 403 with error 1010 to the automated staging-site request. No attempt was made to bypass the block. Direct Supabase checks above succeeded, but Worker configuration, browser views, real sign-in and provider transactions remain unverified. After owner provisioning, resolve allowed test access through Cloudflare's normal settings if the block persists.

The production Supabase project was neither queried nor changed during this staging setup. No invitations, Stripe transactions, payouts or DNS changes were initiated.
