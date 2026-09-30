# Manual payout and promotion-code V1 — September 29, 2026

This revision supersedes earlier Connect/automatic-transfer setup instructions. It preserves the existing design, recruiting/auth flow, lead imports, historical Connect records and accounting history. Target: existing staging Worker and Supabase `bqycqmiaacoeulotjyrv` only. Production database is not part of this release.

## What reps do

1. Sign in at `https://reps.pixelalty.com` and complete the existing onboarding checklist.
2. Open **Payout setup → Set Up Payouts**. Submit email, phone, legal first name, legal last name and the acknowledgment. There are no banking, SSN, verification-code or document fields in this form.
3. Allow up to 24 hours for Pixelalty review. When the owner sends the Stripe setup email, check inbox and Spam/Junk. Enter bank/identity information only in Stripe’s secure form.
4. A Pixelalty administrator checks Stripe manually and approves payout setup. Pixelalty does not claim that this is automatic Stripe verification.
5. Find **My Sales Code** on Home, Money or Onboarding. Copy the assigned code and ask customers to enter it at checkout. The customer gets 2% off; normal fixed commission is unchanged.

Status: Not started → Submitted → Stripe setup pending → Payout setup complete. A correction request displays the reason and reopens the four-field form. New activation requires approved payouts and an assigned code plus the existing agreement, classification, tax, profile and training requirements. Existing active accounts keep workspace access; they do not receive fictitious payout approval.

## Owner setup and operation (your normal browser)

Do not share Stripe passwords, authentication codes, secret keys or banking information in chat. Do not turn off MFA. These steps are intentionally manual; no automated Stripe account, coupon, code or payout creation is performed by Pixelalty V1.

### Payout recipients

1. In Pixelalty, open **Admin → Finance → Payout Setup → View**. Copy the rep’s safe contact/name fields.
2. In your Stripe Dashboard, select the intended sandbox first. Open **Treasury / Global Payouts → Payouts → Recipients → Add recipient** (Stripe may label the navigation differently by account).
3. Use Stripe’s recipient information-collection option to email its secure form. Confirm the correct recipient country; never guess it or collect banking information in Pixelalty. Follow Stripe’s eligibility/activation requirements if this feature is unavailable.
4. Only after Stripe actually sends the setup email, return to Pixelalty and choose **Mark Stripe setup sent** with confirmation. Pixelalty also queues its branded reminder when the existing email provider is configured.
5. After the recipient finishes, review their actual readiness in Stripe. Only then choose **Approve payout setup** in Pixelalty. Optional: store the non-secret recipient reference.
6. For incorrect contact/name details, choose **Request correction** and give a concise, non-sensitive reason. The rep resubmits; no automatic approval occurs.

Stripe documentation: [recipient creation](https://docs.stripe.com/global-payouts/recipient-creation), [testing](https://docs.stripe.com/global-payouts/testing), [sending money](https://docs.stripe.com/global-payouts/send-money). Stripe controls feature eligibility, country support and banking requirements.

### Customer codes

1. In the correct Stripe sandbox, open your product-catalog coupon/promotion-code controls. Create or select a **2% percentage-off** coupon for the intended website packages, then create the customer-facing promotion code you want this rep to use. Do not use a fixed-dollar coupon.
2. Edit the existing sandbox Payment Links to allow promotion-code entry. Preserve each package’s existing intake redirect. Do not replace working live Payment Links with sandbox links on the customer site.
3. In Pixelalty: **Admin → Reps → Manage account → Sales Code → Add Code**. Enter that exact customer-facing code (2–24 letters/numbers, normalized to uppercase). The `promo_…` reference is optional. This only maps an existing Stripe code; it does not create one.
4. Check the rep’s **My Sales Code** card. Duplicate active code assignments are rejected without overwriting another rep.
5. Code changes/deactivation preserve historical sales. Deactivate the old code in Stripe separately when appropriate; Pixelalty deactivation cannot change Stripe. Newly activated reps without a code return to onboarding, while pre-migration active users retain existing access.

| Package | Customer price before discount | Fixed rep commission |
| --- | ---: | ---: |
| Launch | $799 | $125 |
| Growth | $1,299 | $250 |
| Premium | $1,999 | $400 |
| Advanced | $2,999+ | $600 |

Verified Checkout/payment data, not the return URL or rep-entered metadata, creates the sale. A missing, inactive, unknown or wrong-discount code does not invent rep attribution. One payment creates at most one sale, commission and sale-XP award. Unknown product identities remain visible for Finance review with no automatic commission.

### Pay commissions manually

1. Open **Admin → Finance**. Review weekly amounts owed and commission eligibility. Settlement, hold period, tax status, refund/dispute and payout readiness are enforced.
2. Send the actual payout to the correct recipient using your Stripe Dashboard. Pixelalty does not send money.
3. Back in Pixelalty, select the eligible commissions for that one rep, choose **Mark Paid**, enter the actual payment date and optional non-secret reference/note, and confirm the displayed amount.
4. Repeated submissions return the existing record. The same commission cannot be put in a second paid batch. A refund before payment holds the commission; a refund after payment flags recovery review without deleting paid history. Do not erase paid records to hide adjustments.

### W-9 retention

1. Use the existing Finance/Owner + MFA review flow to download and verify the signed PDF.
2. Store it in an encrypted, access-controlled tax/accounting retention location chosen by the business.
3. Choose **Confirm securely archived** only after that storage is complete. Downloading alone never marks a file archived.
4. The app then disables ordinary portal downloads and retains the verification/audit metadata. This release does not automatically delete the restricted Supabase object or the external archive; retention/disposal remains a separately authorized policy decision.

### Lead imports (existing workflow, preserved)

1. Open **Admin → Leads → Imports**. Use UTF-8 CSV (up to 8 MB), or the first sheet of XLSX (up to 40 MB), with at most 25,000 rows per file.
2. Map business name, the actual phone column, and timezone explicitly. Pixelalty aliases include Business, Main Phone, Company Name and Time Zone. Never map a row-number column to phone.
3. For multi-state leads, provide per-row IANA timezones such as `America/New_York`, `America/Chicago` and `America/Los_Angeles`; do not apply one state’s zone nationwide. Unknown zones require correction. Excel formulas are rejected as row errors.
4. Choose **Validate and stage import**. Review valid, duplicate, DNC, ambiguous and invalid rows. Correct/reject ambiguous rows; commit only reviewed valid leads. Staging does not distribute leads.
5. Use existing assignment/claim controls to distribute committed leads; rep capacity, claim exclusivity, expiry and DNC checks continue to apply. Abandon an uncommitted bad batch; use archive/review controls for already imported records rather than deleting calling history.

## Optional SMS

SMS is not login verification. The unchecked recruiting consent checkbox is optional and server-timestamped. No provider configuration means no SMS send and no blocked application/email/onboarding.

To enable later: configure the approved Twilio Messaging Service and sender/consent compliance in your account; store `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_SERVICE_SID` as Worker secrets. Configure its incoming-message webhook to `https://reps.pixelalty.com/api/webhooks/sms`, HTTP POST. The handler validates the provider signature and records STOP opt-outs. Never paste credentials into source or chat. Confirm carrier/registration requirements in Twilio before enabling real sends. System Health explicitly reports an unconfigured provider.

Approval sends only one consented transactional notice to check the invitation inbox/Spam/Junk. Uncertain sends require review instead of automatic replay. No automatic backfill to old applicants.

## Acceptance gates

Automated evidence is recorded in the pull request/CI, not assumed from this document. Local unit/SQL/Worker tests do not certify real inbox delivery, Stripe recipient setup, card payments, settlement or payout transfer. The staging migration must be applied once before the matching Worker release. Keep Stripe in TEST until owner-controlled hosted verification passes.

Remaining hosted acceptance requires an owner-approved test recipient, actual sandbox promotion code, real sandbox payment using the code, actual platform webhook delivery, correct one-sale/commission/XP persistence, and manual payout-readiness confirmation. Mark Paid must never be used to pretend money moved. Do not rerun old migrations or recreate projects, domains, SMTP or existing Payment Links.

## Staging migration receipt

Applied once to `bqycqmiaacoeulotjyrv` on September 29, 2026. Repository file `20260929043114_sales_manual_payouts_and_codes.sql` corresponds to Supabase history version **20260929053846** (`sales_manual_payouts_and_codes`). SHA-256: `962f918cb684b8216c651b8937662e81883b5215a049be7c0f78fadd828dc7ee`. Preserve this mapping; do not reapply the file using its local timestamp.

Readback confirmed all five new public tables have RLS, no anonymous reads and no direct authenticated writes. Baseline remained one rep, one legacy Connect row, zero payments/commissions and two protected tax documents/objects. New payout/code/sale/payment-confirmation tables remained empty; no recipient setup or money movement was fabricated. Production Supabase was untouched.

Security/performance advisors reported no new warnings or errors. The existing **Leaked Password Protection Disabled** Auth warning remains an owner-controlled configuration item ([Supabase guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). Private tables intentionally deny direct access; new indexes are unused until real traffic arrives. Current CI, deployment and hosted acceptance evidence is maintained in [PR #7](https://github.com/Pixelalty/pixelalty-Production-site/pull/7).
