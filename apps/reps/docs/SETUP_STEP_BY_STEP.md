# Connect the remaining services

GitHub and Supabase are already connected to this chat. Reconnecting them is unnecessary. Configure an isolated staging database and Cloudflare Worker, then enter Stripe sandbox credentials directly in Cloudflare.

Repository: `Pixelalty/pixelalty-Production-site`. Branch: `codex/pixelalty-sales-v1`. The public website remains separate at the repository root.

## 1. Create the staging database

1. Open [Supabase Dashboard](https://supabase.com/dashboard).
2. Select the organization containing Pixelalty and choose **New project**.
3. Name it `pixelalty-sales-staging`. Choose a suitable region and save the database password in your password manager.
4. Review the displayed plan/cost before creating it. Wait until ready.
5. Return the project name or reference in chat. The connected Supabase tool can apply the reviewed migrations once this target is identified; you do not need to copy the schema into the SQL editor.

The existing Pixelalty project is `wplinruinysbcgtfpooi`. Do not use that production project for destructive tests. No changes have been applied to it by this branch.

## 2. Create a separate Cloudflare Worker

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/), then **Workers & Pages → Create application**.
2. Choose the repository import/Git option and connect the GitHub account containing Pixelalty. This gives Cloudflare build access, separately from GitHub's connection to this chat.
3. Select `Pixelalty/pixelalty-Production-site` and use these settings. If the initial screen omits a field, configure it in the new Worker's **Settings → Build** before the successful build.

| Setting                                                | Value                                           |
| ------------------------------------------------------ | ----------------------------------------------- |
| Worker name                                            | `pixelalty-sales-staging`                       |
| Git branch / production branch for this staging Worker | `codex/pixelalty-sales-v1`                      |
| Root directory                                         | `apps/reps`                                     |
| Build command                                          | `npm ci && npm run check`                       |
| Deploy command                                         | `npx wrangler deploy --env staging --keep-vars` |
| Build environment variable                             | `NODE_VERSION` = `24`                           |

4. Save and deploy this staging Worker. The app reports missing configuration until later steps are complete.
5. Copy the assigned HTTPS `workers.dev` URL. Do not add `reps.pixelalty.com` yet.
6. Keep other-branch preview builds disabled until their separate bindings are configured. This staging Worker should build only the feature branch.

Review [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) when choosing a plan. The importer accepts up to 25,000 rows and stages 250 per database request; its largest imports exceed the Free plan's 50 subrequests per invocation. Workbook parsing needs CPU/memory validation on the selected plan. The local 5,000-row test verifies database behavior, not Cloudflare quotas.

## 3. Add runtime configuration

Open the new Worker's **Settings → Variables and Secrets → Add**. These are runtime settings, separate from build variables. Set the following values and select Deploy when finished.

| Variable                        | Type   | Value                                                    |
| ------------------------------- | ------ | -------------------------------------------------------- |
| `APP_URL`                       | Text   | Exact staging HTTPS origin without a trailing slash      |
| `SUPABASE_URL`                  | Text   | Staging project URL from its Connect dialog/API settings |
| `SUPABASE_PUBLISHABLE_KEY`      | Text   | Staging project's publishable key                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Secret | Staging server secret key, or legacy `service_role` key  |
| `STRIPE_MODE`                   | Text   | `test`                                                   |
| `STRIPE_SECRET_KEY`             | Secret | Sandbox secret key from step 5                           |
| `STRIPE_WEBHOOK_SECRET`         | Secret | Platform signing secret from step 6                      |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Secret | Connected-account signing secret from step 6             |
| `TURNSTILE_SITE_KEY`            | Text   | Widget site key from step 4                              |
| `TURNSTILE_SECRET_KEY`          | Secret | Widget secret key from step 4                            |

Copy secrets directly between the provider and Cloudflare dashboards. Do not paste them into chat, GitHub, screenshots, build commands or frontend `VITE_` variables. `keep_vars` preserves dashboard values during code deployments; staging and production still need separate values.

## 4. Configure Turnstile

1. In Cloudflare, open **Turnstile → Add widget**.
2. Name it `Pixelalty Sales staging`, add the exact staging hostname and choose a managed widget.
3. Put its site key and secret key into the runtime settings above.

The app submits action `apply` and checks both that action and the hostname on the server. Recruiting submissions are blocked while this is unconfigured.

## 5. Open Stripe's sandbox and enable Connect

1. Open [Stripe Dashboard](https://dashboard.stripe.com/) and use the account picker to switch into a **Sandbox**. Create a sandbox for this integration if needed. Keep every step below in that same sandbox.
2. Complete Connect setup for a platform that pays connected accounts. This implementation uses Stripe-hosted onboarding for Express accounts and separate charges and transfers.
3. Find the sandbox API keys. Copy its `sk_test_...` secret key directly into Cloudflare's `STRIPE_SECRET_KEY`. No Stripe publishable key or hardcoded Price IDs are needed: the server creates Checkout line items from stored package snapshots.

Verify Connect availability and permitted countries with Stripe during acceptance. Use test onboarding details for staging.

## 6. Add two Stripe webhook destinations

In the same sandbox, open **Workbench → Webhooks** and create destinations using **Snapshot events** where that choice is offered.

| Destination | Event source       | Endpoint                                         |
| ----------- | ------------------ | ------------------------------------------------ |
| Platform    | Your account       | `https://YOUR-STAGING-HOST/api/webhooks/stripe`  |
| Connect     | Connected accounts | `https://YOUR-STAGING-HOST/api/webhooks/connect` |

Replace `YOUR-STAGING-HOST` with the actual hostname. For the platform destination select:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
payment_intent.succeeded
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
transfer.reversed
```

For the Connect destination select:

```text
account.updated
payout.created
payout.updated
payout.paid
payout.failed
payout.canceled
```

Copy each destination's `whsec_...` signing secret into the matching Cloudflare Secret variable, then Deploy. Endpoint signing secrets differ from the Stripe API key. Each field needs its own value.

## 7. Configure authentication and owner access

1. In the **staging** Supabase project's **Authentication → URL Configuration**, set Site URL to the staging origin.
2. Add redirect URLs for that origin followed by `/onboarding` and `/profile?reset=1`. A hostname-scoped `https://YOUR-STAGING-HOST/**` rule is acceptable for staging; avoid wildcard hostnames.
3. Keep email/password sign-in, email confirmation and authenticator-app MFA available. Configure transactional SMTP under the project's email/SMTP settings before testing invitations outside your Supabase organization. Store its credentials there.
4. Create or invite the intended owner in the staging project's Auth Users page, then verify the email. Tell the assistant that email or Auth user UUID; never share the password or MFA code.
5. After migrations exist, the role can be bootstrapped with `scripts/bootstrap-owner.sql`, which checks that the selected user is confirmed. Administrator login still requires MFA.

For a later shared production database, preserve the public site's Site URL and existing redirects; append only the approved rep-site redirects.

## 8. Return these non-secret details

```text
Staging Supabase project name/reference:
Cloudflare staging URL:
Intended owner's email or Auth user UUID:
Runtime variables/secrets saved: yes/no
Stripe sandbox and both webhooks configured: yes/no
SMTP and Turnstile configured: yes/no
```

These unlock migration application, owner setup, hosted browser review and provider acceptance. A successful build alone is not a verified payment or rep payout. Production DNS, live Stripe credentials and merging the draft are later release steps after acceptance.

## Provider references

- [Cloudflare Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare runtime secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/)
- [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Stripe sandboxes](https://docs.stripe.com/sandboxes)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
