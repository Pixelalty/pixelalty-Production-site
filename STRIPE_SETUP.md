# Stripe setup for Pixelalty

For the September 20, 2026 policy update, use [STRIPE_LEGAL_SETUP.md](STRIPE_LEGAL_SETUP.md). The existing checkout links and redirects below remain unchanged.

The website already uses your exact five Payment Link URLs. Stripe continues to own checkout and the existing post-payment redirects. These files do not change your Stripe account. Configure the following in your own Dashboard after the public policy pages are live.

## 1. Account-wide public details

1. Sign in to the correct Stripe business account and use **live mode** when editing the supplied live links.
2. Open **Settings → Business → Public details**, or [Public details](https://dashboard.stripe.com/settings/public). The Dashboard may rearrange labels.
3. Confirm the displayed business name is Pixelalty and that the website is `https://pixelalty.com`.
4. Set **Terms of service URL** to `https://pixelalty.com/terms`.
5. Set **Privacy policy URL** to `https://pixelalty.com/privacy`.
6. Set the support/contact website, where available, to `https://pixelalty.com/contact`. Supply only real email/telephone details if Stripe requires them; none have been invented in the site.
7. In checkout/public policy settings, where available, add the **refund/cancellation policy URL** `https://pixelalty.com/refund-policy`. Stripe layouts and fields vary; if there is no separate field for your payment type, keep the prominently linked policy in the Terms and add a clear checkout description referring to the refund policy. Do not claim a setting was configured merely because the website links exist.
8. Save. Under branding, upload your official Pixelalty logo and choose a restrained blue accent. This does not replace any necessary legal business identity Stripe requires.

Stripe documents that setting the public Terms URL enables required agreement, and a configured privacy URL is linked by Checkout: [Payment Link customization](https://docs.stripe.com/payment-links/customize#collect-agreement-to-your-terms-of-service).

## 2. Edit EACH Payment Link

Open **Payments → Payment Links** (or search Dashboard for Payment Links). Open the matching existing link, choose its edit action, and confirm the details below. Keep quantity fixed at 1 for these one-time services unless you intentionally design a different ordering flow.

| Service | USD amount | Existing checkout URL | Existing after-payment redirect |
|---|---:|---|---|
| Launch Website | $799 | https://buy.stripe.com/7sY9AT3A72ro1yybCD0Ny01 | https://tally.so/r/Y52k1d |
| Growth Website | $1,299 | https://buy.stripe.com/6oU28r4Ebea6elkgWX0Ny02 | https://tally.so/r/EkpMON |
| Premium Website | $1,999 | https://buy.stripe.com/3cI4gz3A7d627WW7mn0Ny03 | https://tally.so/r/5BNMP6 |
| Advanced / Ecommerce | $2,999 starting payment only | https://buy.stripe.com/28E28r1rZ2ro7WW4ab0Ny04 | https://tally.so/r/VLrDKv |
| Listing Video | $499 | https://buy.stripe.com/eVqeVd6Mj2rodhg7mn0Ny00 | Preserve the existing Stripe workflow; no URL was supplied |

For each of the five links:

1. Verify the product name, price, currency, one-time payment behavior, and any tax handling you have correctly configured for your business.
2. Find the option labeled **Require customers to accept your terms of service** in the link's options/advanced options, and enable it. If absent, save the account-wide Terms URL first, refresh, and use Stripe's current documentation for the payment type.
3. Save the link. Open checkout and verify that the Terms acceptance checkbox and correct policy URLs are visible.
4. Confirm Privacy Policy and refund/cancellation information appear where supported. Open each policy to ensure it resolves over HTTPS on your real domain.
5. For Launch, Growth, Premium, and Advanced: open the after-payment/confirmation configuration and **preserve the matching Tally redirect above**. The site intentionally has no duplicate intake form or direct questionnaire ordering CTA.
6. For Listing Video: preserve the existing after-payment instructions. No new questionnaire URL has been fabricated.
7. Save and repeat for every row. The website buttons already point to the supplied URLs, but the account's actual product settings must still be verified by you.

## 3. Advanced wording

The main website action is **Request Scope Review**, preselecting Advanced on the contact form. The secondary checkout should describe the payment as a **$2,999 starting payment for the confirmed scope**, not the guaranteed final price for all advanced projects. Ensure your Stripe product description agrees. Page/product counts, integrations, booking, revisions, timeline, recurring costs, and any remaining balance must be confirmed in writing before purchase. Only use the link for projects you have scoped.

## 4. Test without accidental purchases

Open all five live checkout pages and visually confirm the correct product and policy links; simply opening checkout does not authorize payment. For a complete purchase test, use Stripe test mode with equivalent test links and the proper test payment method. Do not enter test card numbers on live links. Confirm the successful checkout reaches the expected Tally page for website packages. Do not alter the live redirect flow simply to test the static site.

The delivered QA verifies exact link strings and website routing. It does not claim to have logged in to Stripe, changed settings, confirmed account activation, or completed payments. Payments, tax settings, customer receipts, and refunds remain administered in your Stripe account.
