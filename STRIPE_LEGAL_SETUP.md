# Pixelalty — Stripe legal settings

Prepared September 20, 2026. Publish the replacement website pages first. This update does not change your Stripe account automatically.

## URLs to use

| Setting | Exact public URL |
| --- | --- |
| Website | https://pixelalty.com |
| Terms of service | https://pixelalty.com/terms |
| Privacy policy | https://pixelalty.com/privacy |
| Refund / cancellation policy | https://pixelalty.com/refund-policy |
| Support / contact website | https://pixelalty.com/contact |

## Configure the existing account and links

1. In the correct **live** Stripe account, open [Public details](https://dashboard.stripe.com/settings/public). Enter the website, Terms, Privacy, and support URLs above in the available fields. Save.
2. Open [Checkout and Payment Links settings](https://dashboard.stripe.com/settings/checkout). Enable the available legal-policy and support displays; supply the refund URL where supported. If no separate refund URL field is offered, retain the direct refund-policy link in the Terms and use an available policy-description field to direct customers to it.
3. Open each existing Payment Link for **Launch, Growth, Premium, Advanced, and Listing Video**. Use its edit action, commonly in the overflow menu. In the available options, enable **Require customers to accept your terms of service**, then save. If unavailable, save the account-wide Terms URL first and consult Stripe’s current options for that link type.

Stripe documents the public URLs, agreement checkbox, and checkout policy displays in its [Payment Link customization guide](https://docs.stripe.com/payment-links/customize).

## Preserve the ordering flow

Keep all five existing Payment Link URLs, prices, currency, and payment behavior. Preserve the four existing Tally redirects and the Listing Video after-payment instructions. Do not create replacement links for this legal update. The exact current checkout/redirect mapping remains in [STRIPE_SETUP.md](STRIPE_SETUP.md).

Advanced remains **starting at $2,999 for a confirmed scope**. Do not describe that starting payment as covering every ecommerce requirement. Use the existing scope-review process before accepting an Advanced order.

## Verify after saving

Open each checkout without paying. Confirm that its policy links resolve to the new pages and that the Terms checkbox appears where enabled. Check that the support link reaches Pixelalty’s contact page. A checkbox is evidence of acknowledgment, not a guarantee of enforceability.

Retain the agreed scope, receipt, policy version, and available checkout acknowledgment with the order records. Older orders keep their applicable terms unless a lawful change is agreed. Actual payments, refunds, tax settings, and customer receipts remain managed in Stripe.

No Stripe login, account change, purchase, or refund was performed as part of preparing these files. Use only real business contact and identity details if Stripe requests additional required information.
