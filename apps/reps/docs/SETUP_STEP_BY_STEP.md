# Finish Pixelalty Sales setup

This checklist continues from the existing staging installation. Do not recreate the database or Worker, rerun completed migrations, or bootstrap the owner again. It supersedes the original first-install checklist and the setup instructions in older status reports.

- Repository: Pixelalty/pixelalty-Production-site
- Sales branch: codex/pixelalty-sales-v1
- Worker: pixelalty-sales-staging
- Supabase: pixelalty-sales-staging, project reference bqycqmiaacoeulotjyrv
- Payments: the existing Stripe sandbox, in test mode

Do not change the existing production Supabase project wplinruinysbcgtfpooi. Attaching public domains to this staging Worker does not enable live payments.

## 1. Finish the existing Private Email SMTP sender

Use the existing Namecheap Private Email mailbox. Receiving or forwarding mail to a personal inbox does not by itself configure the application's outgoing sender.

1. Open [staging SMTP settings](https://supabase.com/dashboard/project/bqycqmiaacoeulotjyrv/auth/smtp).
2. Keep custom SMTP enabled and the working Private Email credentials.
3. Confirm the following fields. Use the actual Pixelalty mailbox you created; do not substitute a personal Outlook address or an uncreated example address.

| Field | Value |
| --- | --- |
| Sender name | Pixelalty Sales |
| Sender email address | The actual existing mailbox at pixelalty.com |
| Host | mail.privateemail.com |
| Port | 465 (SSL) |
| Username | The full Private Email mailbox address |
| Password | That mailbox's password, not the Namecheap account password |

4. Save and reopen the page to confirm the sender name and address are saved. Never send the password in chat.
5. In Namecheap, confirm the mailbox/domain is active and its required SPF/DKIM records are present. Preserve the existing receiving/forwarding setup. Copy provider-supplied DNS values exactly rather than creating duplicate SPF records.

Keep the branded templates already installed. Changing templates does not update emails already delivered.

There are two email paths in the current application:

| Messages | Sending service |
| --- | --- |
| Invitations, password setup/reset, email confirmation, security emails | Supabase Auth through the configured Private Email SMTP |
| Account activation notice and 24-hour onboarding reminder | The application's Resend adapter; configure step 6 |

## 2. Connect the two domains to the existing Worker

1. In [Cloudflare](https://dash.cloudflare.com/), select the account containing pixelalty-sales-staging.
2. Confirm pixelalty.com is an active Cloudflare zone. If it is already active, leave its nameservers alone. If a DNS move is required, preserve and verify all existing customer website and email records before changing nameservers.
3. Open Workers & Pages → pixelalty-sales-staging → Domains → Add Domain. Older dashboards use Settings → Domains & Routes → Add → Custom Domain.
4. Add reps.pixelalty.com and join.pixelalty.com as custom domains on this Worker. Use deployed traffic, not a preview URL.
5. Wait for both domains and their HTTPS certificates to become active. Cloudflare creates the corresponding DNS records. Inspect an existing record conflict before replacing that specific record.

Do not route pixelalty.com or www.pixelalty.com to the sales Worker. Keep the customer website intact. Administration uses reps.pixelalty.com/admin; no separate admin subdomain is required.

## 3. Keep domain configuration in future deployments

Open the Worker's Settings → Builds. Update the existing build integration, not a new Worker.

| Setting | Value |
| --- | --- |
| Repository | Pixelalty/pixelalty-Production-site |
| Branch / production branch for this staging Worker | codex/pixelalty-sales-v1 |
| Root directory | apps/reps |
| Build command | npm ci && npm run check |
| Deploy command | npm run deploy:pixelalty |
| Build environment | NODE_VERSION = 24 |

Save, then retry or trigger the latest branch build. Keep this deploy command permanently so later deployments retain the domain configuration. Confirm the deployment succeeds and becomes the active version; a successful build alone is insufficient.

The prepared command declares both domains and sets these staging runtime values:

| Runtime variable | Value |
| --- | --- |
| APP_URL | https://reps.pixelalty.com |
| RECRUITING_URL | https://join.pixelalty.com |
| INTERNAL_APP_ORIGIN | https://pixelalty-sales-staging.elore-marketing.workers.dev |
| STRIPE_MODE | test |

Check them in Settings → Variables and Secrets after deployment. Existing Supabase, Stripe and Turnstile secrets remain in place. SUPABASE_URL must still point to https://bqycqmiaacoeulotjyrv.supabase.co. Do not switch to the customer production database.

Open these pages:

- https://reps.pixelalty.com/ — Pixelalty sign-in
- https://join.pixelalty.com/ — recruiting/application
- https://reps.pixelalty.com/apply — redirects to join.pixelalty.com
- https://reps.pixelalty.com/admin — requires authorized admin sign-in and MFA

The workers.dev endpoint remains available for internal testing; use the owned domains for all user links.

## 4. Verify authentication and application protection

The staging Site URL and redirect allowlist were saved and verified on 24 September 2026. Check these existing values at [URL Configuration](https://supabase.com/dashboard/project/bqycqmiaacoeulotjyrv/auth/url-configuration); there is no need to reinstall correct settings.

Site URL: https://reps.pixelalty.com

Exact redirect URLs:

- https://reps.pixelalty.com/
- https://reps.pixelalty.com/welcome
- https://reps.pixelalty.com/recover
- https://reps.pixelalty.com/auth/confirm
- https://reps.pixelalty.com/auth/callback

Remove any leftover localhost/development entries used for this hosted flow. Keep the installed Pixelalty templates and their direct Pixelalty token links. Check the four password/email/MFA security notification toggles if not already enabled. The complete template mapping is in [the domain and email guide](PIXELALTY_DOMAINS_AND_EMAIL.md#3-install-the-prepared-auth-configuration).

In Cloudflare → Turnstile, edit the existing application widget and add join.pixelalty.com to its allowed hostnames. Keep the internal staging hostname for internal testing. Save without replacing the existing site/secret keys. The application checks both the hostname and action apply; do not disable this protection.

## 5. Update the two existing Stripe sandbox destinations

Stay in the same Stripe sandbox that holds the existing API key and Connect setup. Open Workbench → Webhooks, edit each existing destination, and save these URLs.

| Destination | Source | URL |
| --- | --- | --- |
| Platform | Your account | https://reps.pixelalty.com/api/webhooks/stripe |
| Connect | Connected accounts | https://reps.pixelalty.com/api/webhooks/connect |

Use Snapshot events where Stripe offers a choice. Preserve/check these event selections.

Platform:

- checkout.session.completed
- checkout.session.async_payment_succeeded
- payment_intent.succeeded
- charge.refunded
- charge.dispute.created
- charge.dispute.updated
- charge.dispute.closed
- transfer.reversed

Connect:

- account.updated
- payout.created
- payout.updated
- payout.paid
- payout.failed
- payout.canceled

If an endpoint's signing secret changes, update the corresponding Worker runtime Secret: STRIPE_WEBHOOK_SECRET for Platform, STRIPE_CONNECT_WEBHOOK_SECRET for Connect. Deploy the new binding. They are different secrets; neither is the Stripe API key. If the existing signing secrets are unchanged, leave them alone.

The application derives Checkout and Connect return URLs from APP_URL. Create fresh Checkout and Connect links after the domain deployment; existing links may retain their original return address. No new Stripe API key or hardcoded Price IDs are needed just for the domain change.

## 6. Enable activation and onboarding notification emails

The existing code sends these two application emails through Resend. Private Email remains the Auth SMTP provider from step 1.

1. Open a Pixelalty-owned [Resend account](https://resend.com/) and add pixelalty.com under Domains.
2. Add the exact verification/DKIM/SPF records Resend provides at their specified DNS names. Do not replace the Namecheap receiving MX records or add a conflicting second SPF record at the same name.
3. Wait for the sending domain to show Verified.
4. Create a sending API key restricted to that domain.
5. In Cloudflare → pixelalty-sales-staging → Settings → Variables and Secrets, save RESEND_API_KEY as a Secret.
6. Save EMAIL_FROM as Text, with the exact format Pixelalty Sales <your actual mailbox at pixelalty.com>. Replace the explanatory mailbox text with the existing address; keep the display name and angle brackets.
7. Deploy those runtime bindings. Do not place this key in frontend variables, build commands, the repository or chat.
8. In Pixelalty Admin → System health, check that branded notifications are configured and review delivery counts. A healthy configuration indicator is not proof of delivery: verify the actual activation message in step 8.

The staging cron already runs every 15 minutes. The onboarding reminder is due after 24 hours for an eligible incomplete account, not immediately after invitation. Do not create duplicate cron triggers or repeatedly activate an account just to test mail.

## 7. Finish business settings inside Pixelalty

At https://reps.pixelalty.com/admin, sign in as the existing owner and complete MFA.

1. Open Workspace settings. Review Recruiting page copy/application settings, Workflow & calling, Progression & training, and Rep activation.
2. Publish the actual agreement, training lessons and readiness quizzes through Training & content. Check the rep can read and complete the published versions.
3. Review Finance package prices, commission amounts and Advanced quote approval requirements. Existing deals retain their stored pricing snapshots.
4. If using manual calling, set the approved business hours/time zones and calling policy. Preserve do-not-call protection and the existing disabled features.
5. For each rep, use Requirements/View readiness to review the actual worker classification, tax status and payout requirements. Contractors use the appropriate Connect onboarding; employee/external-payroll verification must reflect a real arrangement. Do not change classification or disable gates merely to bypass a blocked activation.
6. Use Appearance/Customize workspace for personal appearance preferences; these are saved per account.
7. Activate a rep only when the required checks are genuinely complete.

## 8. Run a fresh hosted acceptance test

Use an inbox you own. Do not delete existing reps or resend an old message with its old link.

1. In a private browser window, apply at https://join.pixelalty.com with a fresh test address you control. Complete Turnstile and verify the submission succeeds.
2. As admin, review the applicant and approve them.
3. Check the received email's sender name and address, Pixelalty branding and setup button. Check spam as well as inbox.
4. Click the new invitation. It must open reps.pixelalty.com, clear the sensitive token from the address bar and show the Pixelalty confirmation screen.
5. Continue and set the password. Complete the profile, agreement, training and required sandbox payout onboarding.
6. Admin reviews readiness and activates the rep. Confirm the rep receives the activation email from step 6.
7. Sign out and back in, refresh, and confirm saved onboarding state. Check the admin login → MFA flow in light/dark/system themes on desktop, tablet and mobile, including after resizing the viewport.
8. As the rep, visit /admin: administrative access must be refused. Verify the rep cannot access another rep's private records.
9. Test password reset and a previously used/expired invite. Fresh reset should work at the Pixelalty domain; the used link should show a branded help state.
10. Check browser/runtime errors and failed requests during these flows. Capture only redacted evidence, never tokens or passwords.

For the existing demo rep, use Admin → Reps → Send setup email and provide the requested reason. This is the existing setup/reset action, not a new application. The newly sent message uses the updated settings; old inbox messages remain unchanged.

## 9. Verify sandbox sales and payments

1. Use the test rep to create/claim a lead and complete the normal qualification/deal workflow.
2. Generate a fresh Checkout link. Open it and pay using Stripe's test card 4242 4242 4242 4242, a future expiry and any three-digit CVC. Never use real card details in this sandbox.
3. Verify the owned-domain return page, paid deal state, fulfillment visibility and exactly one expected commission. Reload to check persistence.
4. In Stripe, confirm the actual event delivery to the platform endpoint received a 2xx response. Resend that same actual event once and verify it does not duplicate the result.
5. Exercise canceled/failed payment states and use a separate test deal for a refund. Confirm the application responds correctly and does not leave an incorrectly payable commission.
6. Complete applicable Connect sandbox onboarding and check actual Connect event deliveries and account status. A platform transfer and a bank payout are different events; respect the application's payout eligibility/hold rules.
7. Review Admin → System health, email delivery counts and the recent scheduled maintenance run. Allow up to one existing 15-minute cron interval.

A green build, a configured-secret indicator or a synthetic webhook alone does not prove this flow.

## 10. Publish the customer-site entry point

After the join domain and application work, open [PR #2](https://github.com/Pixelalty/pixelalty-Production-site/pull/2).

1. Review its customer-site files: the native recruiting section in index.html/styles.css, the footer entry in js/main.js, and apply/index.html.
2. Mark the draft Ready for review, satisfy the repository's checks, then merge it into main using the permitted merge method.
3. Wait for the existing customer-site deployment.
4. Check the Explore sales opportunities section, Join Pixelalty footer link, and https://pixelalty.com/apply. All must reach join.pixelalty.com.

Do not merge the entire sales PR #1 just to publish this entry point.

## Live release is a separate cutover

This checklist finishes the existing hosted staging setup and its acceptance tests. The Worker remains in Stripe test mode even though it uses Pixelalty domains. Do not accept real customer payments or treat sandbox onboarding as live verification.

Live release requires a reviewed isolated sales production environment, live Stripe/Connect credentials and two live webhook destinations, production sender/Turnstile settings, and a controlled domain cutover after acceptance. Provisioning that environment must not modify the existing customer production Supabase project. Merely changing STRIPE_MODE to live is insufficient.

## Official references

- [Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Namecheap Private Email settings](https://www.namecheap.com/support/knowledgebase/article.aspx/10802/2226/how-to-transfer-emails-to-namecheap-private-email-account/)
- [Resend sending domains](https://resend.com/docs/dashboard/domains/introduction)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks)
- [Stripe testing](https://docs.stripe.com/testing)
