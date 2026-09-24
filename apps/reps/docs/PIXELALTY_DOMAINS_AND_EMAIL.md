# Pixelalty domains and branded authentication

This change keeps the current design and the existing staging database. It does **not** migrate or configure the production Supabase project. Do not invite real reps until the hosted acceptance flow at the end succeeds.

| Address | Purpose |
| --- | --- |
| `https://pixelalty.com` | Existing customer website |
| `https://pixelalty.com/apply` | Redirect to recruiting |
| `https://join.pixelalty.com` | Public application |
| `https://reps.pixelalty.com` | Login and rep workspace |
| `https://reps.pixelalty.com/admin` | Authorized administration, with MFA |

The two subdomains use the same Worker. The recruiting hostname serves the public application and its public APIs; portal paths redirect to the rep hostname. Administrative data and changes remain subject to server authorization and RLS. The internal staging endpoint remains available in test mode and is never returned as a public link after cutover.

## 1. Activate the two Cloudflare domains

The official [Cloudflare agent setup](https://developers.cloudflare.com/agent-setup/prompt.md) was read before this work. Cloudflare requires an active `pixelalty.com` zone in the same account as the Worker. Domain management access is required for these steps.

1. Open Cloudflare and select the account containing **pixelalty-sales-staging**. Confirm **pixelalty.com** is an active zone. If another DNS provider currently hosts the zone, copy and verify its existing customer website and email records before any nameserver move. Do not replace the customer site's apex/`www` records with the sales Worker.
2. Open **Workers & Pages → pixelalty-sales-staging → Domains → Add Domain**. In the older dashboard this is **Settings → Domains & Routes → Add → Custom Domain**.
3. Add **reps.pixelalty.com**, then **join.pixelalty.com**. Select deployed/production traffic, not preview-only traffic. Cloudflare creates the DNS records and certificates. If either hostname already has a CNAME, inspect what it serves before replacing it. Do not change unrelated DNS records.
4. In the Worker's **Settings → Builds**, keep branch **codex/pixelalty-sales-v1** and root directory **apps/reps**. Change the deploy command to **`npm run deploy:pixelalty`**, then trigger a build. This prepared command sets these staging-only values and declares both domains on every deployment:

   | Binding | Value |
   | --- | --- |
   | `APP_URL` | `https://reps.pixelalty.com` |
   | `RECRUITING_URL` | `https://join.pixelalty.com` |
   | `INTERNAL_APP_ORIGIN` | `https://pixelalty-sales-staging.elore-marketing.workers.dev` |

   Existing server secrets are retained. Stripe stays in test mode. The command does not deploy `--env production`. If deploying locally instead, run `npm run deploy:pixelalty` from `apps/reps` after authenticating Wrangler to that Cloudflare account.
5. Add **join.pixelalty.com** to the existing Turnstile widget's allowed hostnames. Keep the internal staging hostname for internal testing. Do not disable Turnstile.
6. Open both new HTTPS domains. The rep domain must show sign-in; the join domain must show the application. `reps.pixelalty.com/apply` must redirect to the join domain. Keep sending invitations paused until the email steps below are complete.

The separate activation command is intentional: ordinary staging deployments continue working before the owner has provisioned the zone. Cloudflare documents that Wrangler configuration controls routes on future deployments, so keep the new deploy command after activation.

## 2. Verify the Pixelalty email sender

The application includes a Resend adapter for activation and onboarding messages. Supabase Auth uses custom SMTP for invitation, confirmation, reset and security messages. Both can use the same verified Pixelalty sending domain.

1. In a Resend account owned by Pixelalty, add **pixelalty.com** as a sending domain. Add only the exact verification/DKIM/SPF records Resend supplies, at their stated record names. Do not replace existing customer email MX records or invent a second apex SPF record. Wait for **Verified**.
2. Disable click tracking and open tracking for authentication emails. This preserves the direct Pixelalty URL and avoids rewriting one-time links.
3. Create a sending API key restricted to that verified domain. Keep it in the provider dashboards or a secure local shell, never in the repository or chat.
4. In Supabase, select **pixelalty-sales-staging** (`bqycqmiaacoeulotjyrv`), then **Authentication → Emails → SMTP settings**. Enable custom SMTP:

   | Setting | Value |
   | --- | --- |
   | Sender name | `Pixelalty Sales` |
   | Sender email | `sales@pixelalty.com` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | The Resend sending API key |

5. In **Cloudflare → pixelalty-sales-staging → Settings → Variables and Secrets**, add **RESEND_API_KEY** as a secret and **EMAIL_FROM** as `Pixelalty Sales <sales@pixelalty.com>`. Deploy the changed bindings. These enable the activation email and the 24-hour onboarding reminder. Nothing is sent to existing reps merely by installing the migration.

The default Supabase sender cannot become a Pixelalty sender just by changing HTML. Supabase also restricts email template customization for new Free projects using default SMTP. Custom SMTP is therefore required before installing the prepared templates.

## 3. Install the prepared Auth configuration

The complete configuration is [auth-config.pixelalty.json](../supabase/auth-config.pixelalty.json). It contains no passwords or API keys. It sets the Site URL, exact redirect allowlist, sender name, ten email templates/subjects and four security notifications.

**Automated installation:** from `apps/reps`, privately set `SUPABASE_ACCESS_TOKEN` in your local shell, then run:

```sh
npm run auth:configure
npm run auth:configure -- --apply
```

The first command checks readiness. The second writes and verifies the settings. The script refuses any project other than `bqycqmiaacoeulotjyrv`, requires custom SMTP, and checks that both Pixelalty domains serve this staging application. It does not print credentials or write to production.

**Dashboard alternative:** in staging **Authentication → URL Configuration**, set Site URL to `https://reps.pixelalty.com`. Replace development redirect entries with these exact addresses:

```text
https://reps.pixelalty.com/
https://reps.pixelalty.com/welcome
https://reps.pixelalty.com/recover
https://reps.pixelalty.com/auth/confirm
https://reps.pixelalty.com/auth/callback
```

In **Authentication → Emails**, copy the HTML and subjects from the configuration into the corresponding email editors:

| Email editor | HTML file |
| --- | --- |
| Invite user | [invite.html](../supabase/templates/invite.html) |
| Reset password | [recovery.html](../supabase/templates/recovery.html) |
| Confirm signup | [confirmation.html](../supabase/templates/confirmation.html) |
| Magic link | [magic_link.html](../supabase/templates/magic_link.html) |
| Change email address | [email_change.html](../supabase/templates/email_change.html) |
| Reauthentication | [reauthentication.html](../supabase/templates/reauthentication.html) |
| Password changed | [password_changed_notification.html](../supabase/templates/password_changed_notification.html) |
| Email address changed | [email_changed_notification.html](../supabase/templates/email_changed_notification.html) |
| MFA method added | [mfa_factor_enrolled_notification.html](../supabase/templates/mfa_factor_enrolled_notification.html) |
| MFA method removed | [mfa_factor_unenrolled_notification.html](../supabase/templates/mfa_factor_unenrolled_notification.html) |

Enable those four security notifications. Do not replace the templates' Pixelalty links with the provider's generic confirmation URL. The links carry the token in a URL fragment, which is removed immediately on arrival. A confirmation button consumes the one-time token, protecting it from email scanners.

Old emails are unchanged and may contain the broken destination. From **Admin → Reps → Send setup email**, send a fresh setup/reset link after configuration. This action requires an authorized admin with MFA, records a reason, and limits repeat sends. Do not delete and recreate the rep.

## 4. Publish the small customer-site change

The prepared change adds a **Join Pixelalty** link to the existing footer through `js/main.js` and adds `apply/index.html` as the clean redirect. No customer page is redesigned. Publish these two files through the existing customer-site deployment only after the join domain works. Do not merge the entire sales application branch into the customer website solely to publish this link.

## 5. Hosted acceptance — still required

Use an inbox you own; do not publish its address, message body, tokens or account IDs in the repository. The local browser suite uses simulated provider transport and is **not** a substitute for this acceptance.

1. Apply through `join.pixelalty.com` with the test inbox and complete Turnstile.
2. Sign in at `reps.pixelalty.com`, verify MFA, review the applicant under Admin, and approve.
3. Verify the received sender is **Pixelalty Sales** at the verified Pixelalty address; inspect the Pixelalty template and setup button.
4. Click the email. It must open `reps.pixelalty.com/auth/confirm`, remove credentials from the address bar and ask you to continue. No localhost, developer hostname or provider error page is acceptable.
5. Continue, create the password, complete the profile/agreement/training and appropriate test onboarding requirements. Confirm persistence after signing out and back in.
6. Check login → MFA in light/dark/system themes, desktop/mobile/tablet and after changing viewport height. Confirm no white bands and no horizontal scrolling.
7. Verify the admin can review and activate the account, while the rep cannot read applications, another rep's private records or perform an admin action.
8. Verify the activation email and any pending onboarding reminder in the provider delivery log and the test inbox. Check **Admin → System health** for delivery configuration and counts. Provider acceptance is not proof of inbox delivery.
9. Test an expired/used link and a fresh reset link. The expired link must show the Pixelalty help state, and the fresh link must reach password setup at the owned domain.

Onboarding emails are queued privately, leased, retried with a frozen payload and an idempotency key, and stopped for review before the provider's 24-hour idempotency period expires. Mail errors do not block payment reconciliation. Review uncertain deliveries in the provider dashboard before retrying them manually; the app does not blindly resend them.

## Official references

- [Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare configuration source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Free template change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
- [Resend SMTP with Supabase](https://resend.com/docs/send-with-supabase-smtp)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
