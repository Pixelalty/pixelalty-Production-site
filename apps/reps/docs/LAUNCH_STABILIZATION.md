# Launch stabilization acceptance — 2026-09-27

**NO-GO for launch.** The implementation and isolated regression gates pass. Real hosted tax submission, Connect onboarding, Checkout/payment/webhook/commission, and disposable-account deletion still require acceptance. Do not present simulated external-provider tests as hosted proof.

Scope: Pixelalty Sales staging project `bqycqmiaacoeulotjyrv`, branch `codex/pixelalty-sales-v1`. Customer production Supabase was not touched. Preserve the current design and Express/Account Links architecture. Stripe remains TEST.

## Resume checkpoint — 2026-09-27 15:16 UTC

**The Accounts v1 setting is now enabled and the account-creation blocker is resolved. Do not ask the owner to enable it again.** The first retry after the setting changed still failed because Stripe explicitly returned `idempotent-replayed: true` for the original HTTP 400. It was a cached rejection, not evidence that the owner's setting change failed.

Application commit `58f6fed76f8145f9b3c39f6d7dc130ffdc7dd8eb` fixes this through the existing audited TEST-only Finance recovery. After enumerating all connected accounts and finding no match, it rotates only a replayed HTTP 400 attempt. Existing database locking, the ten-minute guard, financial-history protection and account reuse remain enforced. Fresh rejections, uncertain 5xx failures and recent attempts retain their identities. Ordinary rep retries do not gain Finance permissions.

The diagnostic commit `555785219ab4b81c1a134a5c276ab9790e9a8547` identifies the connected platform account to authorized health reviewers and records only a bounded replay flag and HTTP status. Ordinary reps cannot access this information. The earlier commit `4dc3f44e8ca2db70053374639725ee22f76eb274` fixed the real Admin health crash caused by displaying a numeric HTTP status as a text badge.

Latest [CI run 36295713170](https://github.com/Pixelalty/pixelalty-Production-site/actions/runs/36295713170), job `108554049901`: every code, SQL, concurrent PostgreSQL, browser, auth, onboarding, branding and deployment dry-run step passed. All 17 targeted launch tests also passed locally. Cloudflare Worker build `b6f555fc-f51a-49ab-8c8a-1eea0c1eeb0d` deployed version `317734e7-f5bf-41f8-8d7e-ab370984f05d` successfully.

Actual hosted verification, using Owner + MFA and the existing PXL-00003 demo rep:

- Audited recovery succeeded at 15:13 UTC and persisted one Express connected account: `acct_1UKJlSF1LjQlhYZT`.
- The rep's Set Up Payouts Securely button opened real Stripe TEST onboarding.
- Stripe's Return button returned to `https://reps.pixelalty.com/onboarding?step=payout`; the application refreshed payout status successfully.
- Opening payout setup again reached onboarding using the same stored account. Staging has one connected rep and one recovery reset for this verification; no duplicate account was created in the application mapping.
- The Pixelalty page recorded no site-origin runtime errors in this flow.
- Payouts, transfers and details-submitted remain false because the provider signup has not been completed. The browser is ready at the TEST signup screen, which offers Use test phone number and includes Stripe terms. The owner must complete that signup/terms step; no personal bank or tax data has been invented.
- Stripe currently displays its existing sandbox name, Edward's Marketing Agency sandbox. That provider branding still needs to be changed to Pixelalty before launch.

No migrations or infrastructure were recreated. The customer production database was not touched. The remaining tax, invitation, webhook/payment/commission, activation and disposable-account deletion gates below are still open.

## Verified deployed implementation

Application commit: `7a21bfe22abb750e3668a80f6077c84febc820e2`.

Cloudflare Worker build `26870490-c1ec-400f-9b23-1a0b292f5ed5` succeeded. Worker version: `c16b1991-3f92-4f19-ac95-c71ec7693333`. The owned-domain account-management screen and the new diagnostic recording were exercised after deployment.

| Requirement | Implementation and regression evidence | Real hosted status |
| --- | --- | --- |
| Tax upload | Shared client/server PDF preflight; explicit interactive IRS guidance; safe page-opening destinations accepted; scripts, XFA, embedded files and encrypted content rejected; private upload/review/replacement/download audit | No owner-approved test PDF uploaded yet; zero tax rows and private objects |
| Connect | Existing Express creation retained; account reuse; fresh Account Link on retry/expired-link refresh; authorized sandbox orphan/stale-attempt and cached-rejection reconciliation; safe request references and redacted staging diagnostics | Real account creation, onboarding destination, owned-domain return and retry verified; owner-controlled TEST signup/terms completion remains pending |
| Delete Account | Owner + MFA, reason, identity and typed confirmation; immediate session/access revocation; Auth removal; safe purge or minimized non-login retained identity; protected payment/legal history preserved; separate test purge | Both outcomes pass SQL/Worker/browser tests; no existing hosted account deleted |
| Manage Account | Mutable profile, roles, suspension, session revocation, password/email workflows, goals, team/tier/capacity, access overrides and corrections; verified onboarding workflows linked; immutable finances retained | Owner opened actual PXL-00003 manager and payout recovery; destructive hosted acceptance pending |
| Career XP | Event ledger, configured defaults, duplicate guards, reasoned positive/negative integer corrections, history with running balance, shared totals and persistence | Existing hosted rep's 11 training awards total 275 XP; new corrections and fresh-login persistence pass isolated browser tests |
| Customization | Bounded themes, accents, density, sidebar/card/motion presets, profile appearance, optional dashboard widgets, save/retry and cross-login persistence | Mobile/tablet/desktop isolated browser acceptance passes; existing design retained |
| Checkout/accounting | Server-authoritative integer-cent packages, fixed commission defaults, signed webhook processing, duplicate guards, refunds/reversals and durable Deal linkage | Zero hosted payments and commissions; actual sandbox payment journey not passed |
| Webhook separation/health | Separate signing secrets and channel handling, mapped account events, harmless event acknowledgement, unresolved mappings retained for Finance, health counters | API connected in TEST; expected owned-domain destinations not found by endpoint inventory; no verified platform delivery; 39 historical unattributed events preserved |
| Auth/MFA/authorization | Per-request valid session checks, revoked/deleted access blocked, Owner-only destructive actions, server role/MFA checks, RLS separation, responsive MFA | Real Owner login/MFA and workspace navigation verified; isolated regression has no runtime/API failures |
| Application/invitation | Existing owned-domain recruiting and branded auth flow retained; isolated full invitation/password/onboarding flow passes | Disposable application prepared but not submitted: this browser requires human verification; no new invitation sent |

## Historical hosted Connect failure — resolved by the resume checkpoint above

At 2026-09-27 03:18:45 UTC, Owner used Recover payout setup for the existing demo rep. The request reused the current idempotent attempt after checking for matching connected accounts. No account or financial record was fabricated.

- Application request: `04316b96-73a8-495f-9051-388b32661155`
- Stripe request: `req_1iq1EdRVdWPVb4`
- Route: `/api/connect/recover`
- HTTP result: 502
- Safe diagnostic category: `PAYMENT_REQUEST_CONFIGURATION`
- Redacted diagnostic identifies `connect_account`: Stripe rejects Accounts v1 account creation and instructs the platform to enable Accounts v1 support for a supported compatibility scenario.

This is the observed blocker, not a guessed bank-data, metadata, capability or Account Link problem. Creation fails before an Account Link can be requested.

Stripe documents this exact error and the compatibility setting:
https://support.stripe.com/questions/fix-the-accounts-v1-is-no-longer-recommended-error-for-connect-integrations?locale=en-GB

The owner has now enabled this setting:
https://dashboard.stripe.com/settings/features/feat_accounts_v1_support

Do not switch to live mode or repeat this setup step. The successful hosted recovery and Account Link flow are recorded above. **Next owner action:** complete the open Stripe TEST signup, including its terms, using the test-data controls. After that, verify the actual returned status and continue the remaining acceptance gates.

The prior implementation also left an unbound Connect creation attempt permanently blocked after its idempotency safety window. The new authorized recovery handles this without silently creating duplicate connected accounts or rewriting financial history.

## Automated gates — all passed

[CI run 36290727061](https://github.com/Pixelalty/pixelalty-Production-site/actions/runs/36290727061), job `108540162115`, application commit above:

- ESLint: passed with zero allowed warnings.
- Type checks: passed.
- Unit, migrated SQL and Worker integration: **85 passed, 0 failed**.
- PostgreSQL 17 concurrent-connection tests: **9 passed, 0 failed**.
- V1 workspace browser suite: passed; no recorded runtime errors or unexpected API failures.
- Auth/MFA browser suite: passed, including actual login-to-MFA UI flow, light/dark/system and 390/768/1440 viewports.
- Onboarding/account browser suite: passed, including PDF review/replacement, Connect return, activation, profile and XP persistence, retained deletion and disposable purge.
- Customer website/email branding browser suite: passed.
- Production build: passed.
- Wrangler staging deployment dry run: passed.
- Cloudflare Worker build/deployment: passed.

Browser artifact: `10922420954`, 36 evidence files. Artifact SHA-256: `a5d8b0f1c102837dd10501100516abf75f5d2e48c1c8e8aa545926cb2cc97510`. Responsive account-management, MFA and appearance screenshots were reviewed.

External Auth/email/Stripe/Storage transports are simulated in these isolated suites. They prove application and database behavior, not actual inbox delivery, provider onboarding, private hosted storage or payment settlement.

## Staging migrations applied once

| Source file | Recorded staging version | Name |
| --- | --- | --- |
| `20260927021822_sales_launch_stabilization.sql` | `20260927025459` | `sales_launch_stabilization` |
| `20260927025757_sales_private_rpc_boundaries.sql` | `20260927025929` | `sales_private_rpc_boundaries` |
| `20260927030716_sales_payment_diagnostic_detail.sql` | `20260927031118` | `sales_payment_diagnostic_detail` |

Do not reapply these or older migrations. The tool assigns remote timestamps; preserve this mapping. Changes to already applied files are prohibited.

The private identity ledger preserves accounting foreign keys after Auth deletion. Only application foreign keys formerly targeting Auth identities were migrated; customer production and Auth-managed schema dependencies were not modified. Elevated work remains inside private, search-path-fixed functions behind server authorization. Public wrappers use invoker boundaries.

Staging has four Auth users and three rep profiles. The resume checkpoint added one connected account through the hosted recovery flow. Payments, commissions, tax documents and private tax objects remain unverified with the prior read-only baseline at zero. No existing demo account was deleted. Security advisors identify intentional deny-by-default private tables and the existing disabled leaked-password protection setting; no paid-plan change was made.

## Remaining acceptance sequence

These are engineering acceptance gates, not a request for the owner to do a long checklist:

1. Complete the owner-controlled Stripe TEST signup from the verified real Account Link, then verify returned capabilities and persisted payout readiness. The compatibility setting, account creation and link/return/retry flow are already verified.
2. Complete the user-controlled public application verification and test inbox/password flow.
3. Upload an approved safe test PDF through the hosted rep route; confirm the private object, submitted status, Finance download/review, refresh and fresh-login persistence.
4. Complete legitimate classification/agreement/training/payout gates and activate the test rep.
5. Run hosted CRM, Deal and sandbox Checkout; verify real signed webhook delivery and exactly one correct payment, commission, XP award and fulfillment record, including duplicate delivery.
6. Exercise both deletion outcomes using clearly disposable staging accounts, confirm Auth/session revocation and preserved historical records.
7. Re-audit errors, permissions, persistence and responsive behavior. Only then make a launch decision.

Request one exact owner action at a time. Never fabricate tax/legal evidence, activate a rep by bypassing readiness checks, disable human verification for acceptance, or claim that a passing mock proves hosted success.
