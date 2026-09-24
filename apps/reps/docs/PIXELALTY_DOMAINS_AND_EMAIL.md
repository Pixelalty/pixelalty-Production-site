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

## 2. Verify the existing Private Email sender

The current setup uses **Namecheap Private Email for Supabase Auth SMTP**. Keep that provider and the working mailbox credentials. The application's activation and onboarding reminder emails use its separate Resend adapter. SMTP settings in Supabase do not configure the Worker mail queue.

1. Open staging **Authentication → Emails → SMTP settings**. Keep custom SMTP enabled and confirm:

   | Setting | Value |
   | --- | --- |
   | Sender name | `Pixelalty Sales` |
   | Sender email | The actual existing Pixelalty mailbox |
   | Host | `mail.privateemail.com` |
   | Port | `465` (SSL) |
   | Username | The full Private Email mailbox address |
   | Password | The mailbox password, not the Namecheap account password |

2. Save and reopen to verify the sender name and address. Receiving or forwarding mail to a private inbox alone does not configure the outbound sender. Keep Namecheap's required SPF/DKIM records and the existing receiving MX records.
3. For activation notices and the 24-hour onboarding reminder, verify a Pixelalty sending domain in Resend. Add only its exact supplied DNS records at the stated names; do not replace Namecheap's receiving MX records or add a conflicting second SPF record.
4. Create a sending API key restricted to that verified domain. In **Cloudflare → pixelalty-sales-staging → Settings → Variables and Secrets**, add **RESEND_API_KEY** as a Secret and **EMAIL_FROM** as Text in the format `Pixelalty Sales <your-existing-mailbox@pixelalty.com>`, replacing the example with the real mailbox. Deploy those bindings.
5. Check **Admin → System health**, then verify actual activation mail in the test inbox. Configuration presence alone does not prove delivery.

Do not replace the working Private Email SMTP credentials with Resend credentials. The two sending paths can use the same verified Pixelalty domain. The default Supabase sender cannot become a Pixelalty sender just by changing HTML; custom SMTP is required for the intended sender identity.

See [Finish Pixelalty Sales setup](SETUP_STEP_BY_STEP.md) for the complete ordered continuation checklist, including domains, Stripe, Turnstile and real hosted tests.

## 3. Install the prepared Auth configuration

The complete configuration is [auth-config.pixelalty.json](../supabase/auth-config.pixelalty.json). It contains no passwords or API keys. It sets the Site URL, exact redirect allowlist, sender name, ten email templates/subjects and four security notifications.

**Automated installation:** from `apps/reps`, privately set `SUPABASE_ACCESS_TOKEN` in your local shell, then run:

```sh
npm run auth:configure
npm run auth:configure -- --apply
```

The first command checks readiness. The second writes and verifies the settings. The script refuses any project other than `bqycqmiaacoeulotjyrv`, requires custom SMTP, and checks that both Pixelalty domains serve this staging application. It does not print credentials or write to production.

The staging Site URL and exact allowlist below were saved and verified on 24 September 2026. If they already match, leave them in place. Keep templates already installed; the script also preserves the existing SMTP host, credentials and sender address.

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
- [Namecheap Private Email settings](https://www.namecheap.com/support/knowledgebase/article.aspx/10802/2226/how-to-transfer-emails-to-namecheap-private-email-account/)
- [Resend sending domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
