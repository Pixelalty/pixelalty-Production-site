# Auth, domains and branding acceptance — 24 September 2026

The current visual direction is preserved. This revision fixes the auth viewport and callback code, adds branded email templates/delivery, and prepares the Pixelalty domain cutover. **Hosted domain and real inbox acceptance remains open.** Local provider simulations do not satisfy that gate.

| Requirement | Implemented / verified | Hosted gate |
| --- | --- | --- |
| MFA fills viewport; centered card; light/dark/system; resizing | Shared auth shell and root background; login → wrong code → successful MFA; 390/768/1440 widths and 520/760/900 heights; system theme changes | Repeat with real admin session after deployment |
| Pixelalty invitation, confirmation, reset, activation and onboarding emails | Ten Auth templates; activation and delayed onboarding templates; responsive HTML reviewed | Verified sender/custom SMTP, templates installed, actual inbox receipt |
| Invitation opens account setup without localhost | Canonical URL validation; explicit token-hash/implicit/PKCE callback; password setup and fresh sign-in verified through actual UI and SQL | Auth Site URL/allowlist and real invitation on owned domain |
| Expired/invalid/replacement links | Branded help state, parameter cleanup, retryable network/rate errors, same-tab replacement link handling, authorized resend | Reissue the old broken invitation after configuration |
| Recruiting / rep / admin domains | Host routing, public-only recruiting APIs, same-origin mutation validation and staging activation command | Cloudflare zone/domains/certificates, Turnstile hostname and deploy command |
| Main-site recruiting entry | Small footer link and `/apply` redirect; responsive menu/link/redirect browser tests | Publish the two customer-site files after `join.pixelalty.com` works |
| Provider details and auth privacy | Friendly error mapping, no provider IDs in rep money view, URL credentials removed, no-referrer, no client secrets, private queued email state | Existing Auth security configuration reviewed below |
| Authorization/RLS | Anonymous denial, no admin actions before MFA, rep/admin isolation, private queue deny grants; existing financial/RLS tests preserved | Repeat with hosted test accounts |
| Complete onboarding | Application, approval, invite, password, profile, agreement, all required lessons/quizzes, admin verification, activation, fresh sign-in and recovery pass locally | Actual test inbox + hosted provider configuration required |

## Test evidence

- `npm run check`: 64 tests pass; ESLint, TypeScript and production build pass.
- `npm run test:auth`: actual React screens, Supabase SDK, Worker routes and migrated SQL; external Auth/email boundary simulated explicitly. No unexpected API failures or console/runtime errors.
- `npm run test:branding`: customer footer/menu at three widths, recruiting destination and `/apply` redirect, desktop/light and mobile/dark generated invitation HTML. Production database requests are intercepted in this isolated preview.
- `npm run test:e2e`: existing V1 SQL-backed workflow and workspace customization regression suite. The preference-save failure expectation now checks a safe Pixelalty message instead of raw provider text.
- `npm run test:concurrency`: includes the existing six PostgreSQL 17 contention scenarios plus twelve email workers competing for one notification lease. Current CI results are recorded on the PR.
- Wrangler dry run passes for the ordinary staging configuration and the prepared two-domain configuration. The activation script leaves production configuration unchanged.

Reviewed fixture-only visuals: [desktop MFA](images/auth-mfa-desktop.png), [mobile dark MFA](images/auth-mfa-mobile.png), [invitation email](images/auth-invitation.png). These screenshots are not evidence of a signed-in hosted session or an email delivered to an inbox.

## Staging database

Applied only to **pixelalty-sales-staging**, ref `bqycqmiaacoeulotjyrv`:

| Local file | Recorded staging version |
| --- | --- |
| `20260924051744_sales_branded_auth_mail.sql` | `20260924054601` |

The original migrations are unchanged. No fixture users or application records were inserted remotely. The new queue contained zero messages after installation. Read-only checks confirm RLS enabled and no SELECT grants for `anon` or `authenticated`.

Security advisors report the intentionally private, deny-by-default tables (`mail_outbox`, `quiz_keys`, `rate_limits`) as RLS-without-policy information notices. The existing **leaked password protection disabled** warning remains: this is an owner-controlled Auth setting and was not changed through unsupported database access. Enable it in the staging password-security settings if available for the project's plan; no plan upgrade was purchased.

## External state and limits

The connected Supabase tools can apply SQL but do not expose Auth configuration. The dashboard requires an authenticated owner session. Cloudflare management authorization and SMTP credentials are unavailable to this session. Browser attempts to open both requested custom domains returned a gateway connection error; this alone does not establish their public DNS state. No DNS, SMTP or Auth setting was changed remotely.

The deploy command and complete email configuration are ready. Follow [the exact owner setup guide](PIXELALTY_DOMAINS_AND_EMAIL.md), then perform its real hosted invitation acceptance. Keep this release in draft until that evidence exists. The production Supabase project remains untouched.
