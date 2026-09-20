# Pixelalty website QA report

Prepared September 20, 2026. This report distinguishes tests completed locally from checks that need the owner's real accounts and production domain.

## Delivered

16 complete HTML pages: home; Web Design overview; Launch, Growth, Premium, and Advanced detail pages; Listing Videos; Reviews; Leave a Review; About; Contact; Terms; Privacy; Refund Policy; 404; and Admin. Also included: shared responsive styles, modular JavaScript, original and optimized branding, 1200×630 Open Graph image, favicon assets, manifest, sitemap, robots.txt, CNAME, .nojekyll, optional host headers, Supabase setup SQL, and setup/security guides.

The existing site is deployed at https://pixelalty-production-site.pages.dev/. This Appearance update has been implemented and tested locally, but has not been deployed or applied to the hosted database. The full archive preserves the browser-safe public configuration retrieved from that deployed site. No passwords, secret keys, customer records, fabricated testimonials, or fabricated listing demo are included.

## Static checks — passed

- All 16 pages have one H1, a unique title and description, canonical URL, and page-specific Open Graph/Twitter text.
- Local page, stylesheet, script, image, favicon, manifest, and fragment references resolve. No dummy `href="#"` links were found.
- Every purchase CTA on its service page matches the supplied Stripe URL exactly, with no cross-package payment destinations.
- Package prices are $799 / $1,299 / $1,999 / starting at $2,999; Listing Video is $499. Advanced's primary CTA goes to Contact with Advanced preselected.
- Public HTML does not expose Tally questionnaires as order links; the known URLs remain in configuration/documentation for the existing Stripe redirect flow.
- `admin.html` is absent from public navigation. Admin, review submission, and 404 pages use noindex; the sitemap excludes them.
- `CNAME` is `pixelalty.com`; robots references `https://pixelalty.com/sitemap.xml`; sitemap public URLs match the requested domain.
- All first-party JavaScript passes Node syntax checks.
- All five original PNG files were compared with the uploaded bytes by SHA-256 and are unchanged. Web derivatives preserve the supplied artwork. The generated social card is exactly 1200×630.
- First-party code contains no service-role/Stripe secret/admin password, eval, or unsafe HTML insertion for customer content. Supplied provider URLs and Instagram destination were checked against the brief.

## Browser and responsive checks — passed

Local Chromium rendered all 16 pages at **320, 375, 390, 430, 768, 1024, and 1440px** widths: 112 page/width checks with **no horizontal document overflow**. The comparison table scrolls inside its labeled container on phones. Package cards use a larger, readable single-column layout on narrow screens.

Desktop homepage and mobile homepage/package-page screenshots were inspected. The pages use the official branding, readable hierarchy, consistent spacing, and intact artwork. Tests exercised the mobile navigation toggle, Escape closing/focus restoration, Advanced contact preselection, unconfigured form/admin states, and missing-video fallback.

Automated axe WCAG A/AA checks on Home, Web Design overview, Growth detail, Listing Videos, Reviews, Contact, Leave a Review, Admin, and Privacy found **no violations in the tested default states after correction**. A primary-button contrast issue was found and fixed before the final pass. This is an automated sample, not a complete accessibility certification or assistive-technology audit. Keyboard labels, focus styles, semantic controls, reduced motion, and safe content insertion were also checked.

**No JavaScript page exceptions** were observed. Before the actual MP4 is uploaded, its existence-check HEAD request receives an expected 404 in the developer console; the visitor sees the designed placeholder, not an error or broken player. There were no unexpected console errors in the unconfigured page pass. No Lighthouse score is claimed.

## Database authorization and validation — passed locally

The complete SQL was executed against a local PostgreSQL engine (PGlite), with Supabase-like `auth.uid()`/`auth.jwt()` fixtures and separate anon/authenticated roles. This runs SQL/RLS behavior; it does not claim to reproduce hosted GoTrue or every Supabase deployment setting.

Passed checks:

1. Schema, function, grant, trigger, and RLS creation.
2. Anonymous direct access to reviews, inquiries, and profiles rejected; role insertion/promotion blocked.
3. Public review submission accepted, with injected approved/verified/featured fields ignored.
4. Successful retry deduplicated; pending review absent from public results; server email cooldown enforced.
5. Invalid rating, confirmation, honeypot, short body, email, and future form time rejected.
6. Non-admin with MFA cannot read private records or elevate its role.
7. Admin identity check can support enrollment, but AAL1 cannot read private data.
8. AAL2 admin can read records; attempts to rewrite review body, rating, or email are rejected.
9. Published output contains only safe columns; low rating and original text remain unchanged; service filter works.
10. Contact scope details stored privately; retries deduplicate; cooldown enforced; administrator may change status but not customer message.
11. Hiding needs a moderation reason and removes public visibility.
12. Authorized administrator deletion works.
13. Every security-definer function has a fixed search path.

These checks used synthetic records in an isolated test database. They are not seeded in the delivered installation SQL.

## Browser workflow integration — passed with simulated API responses

The real bundled Supabase JavaScript SDK ran in Chromium while a local test intercepted its Supabase requests. No requests or fake records were sent to a live business database. This checks frontend integration and behavior independently of the SQL tests above.

- First login starts TOTP enrollment while private content remains locked.
- Incorrect OTP leaves the dashboard locked; successful verification opens it and removes the QR/secret from the DOM.
- Later sign-in challenges the existing factor; non-admin sign-in is rejected.
- Dashboard counts derive from the returned records/counts, not invented numbers.
- Approve, feature, manual verify, and public response controls save appropriate fields. Original low rating is preserved.
- Customer HTML-shaped text is displayed literally and does not execute. Public cards receive no reviewer email/reference.
- Inquiry New → Read → Archived changes work.
- Sign-out removes private record contents from the DOM.
- Public service filters show an honest empty state when no matching reviews exist.
- Advanced inquiry submits structured scope details and confirms only after success.
- A failed review submission preserves input; retry keeps its request ID; success says awaiting moderation.
- A real test-only MP4 was supplied to the expected URL in the test: native metadata loaded and the video automatically replaced the placeholder. The black test clip is not shipped or presented as a Pixelalty demo.

## Requires owner setup or live verification

- For the existing live project, run only `supabase/ADD_APPEARANCE_EDITOR.sql`, deploy the changed frontend files, and use the existing administrator and MFA factor. Do not rerun first-install SQL or recreate accounts.
- Verify real authentication, MFA enrollment/challenge, RLS, CORS, account recovery, and form persistence in your own Supabase project. Local tests are not a hosted penetration test.
- Confirm each live Stripe product/amount, account activation, policy acceptance, receipt behavior, tax treatment, and exact after-payment redirect in Stripe. The public research tool could not open the supplied checkout URLs; their strings were verified against the brief, but live checkout contents and transactions were not tested. No payment was made and no Stripe setting was changed.
- Confirm your actual Tally questionnaires and existing listing-video fulfillment flow. No questionnaire has been replaced.
- Deploy the update through the existing GitHub / Cloudflare Pages workflow and test HTTP headers on the actual host. GitHub Pages' commercial-use limitations are documented in README_SETUP.md; technical file compatibility is not permission to use that service for this business.
- Review business/legal policies for your real practices and selected providers. They are practical drafted terms, not an attorney-review claim. Update the hosting provider named in Privacy before launch.
- Upload the real authorized `assets/listing-video-demo.mp4` later and verify playback on actual mobile devices; captions/rights depend on the final footage.
- Check the dashboard for inquiries; automatic email notifications are not configured.
- Monitor abuse and quotas. Per-email rate limiting is implemented, but no CAPTCHA, IP firewall, or verified-email submission is claimed.

See README_SETUP.md for the complete A–R launch steps and STRIPE_SETUP.md for the five-link checklist.


## Appearance update — September 20, 2026

### Implemented

The private Appearance tab includes every requested color/style control, three ready-made presets plus Custom, a fixed four-font list, contrast-safe official wordmark variants, an isolated visual preview, desktop/mobile and expanded preview modes, private drafts, explicit Publish confirmation, Revert to Published, version history, and draft restoration. Public CSS has complete Premium Hybrid defaults and validated custom-property overrides. No arbitrary HTML/JS/CSS editor or remote font input exists.

The additive migration enables RLS on the new tables, exposes only published design data through a narrow anonymous RPC, requires admin + AAL2 for every private operation, validates settings at the database layer, uses locked revision checks, and retains publications atomically. The original first-install file, generator, setup guide, security guide, and this report have been updated.

### PostgreSQL migration and authorization tests — passed

Executed the base schema and the new migration against local PGlite PostgreSQL with isolated Supabase Auth claim fixtures. Existing synthetic review, inquiry, profile, and Auth rows were snapshotted before the upgrade and compared afterward. The migration ran twice before use and again after saving drafts and publications; existing data and all Appearance state/history were unchanged on rerun.

- Anonymous users cannot read either base settings table or history, invoke editor RPCs, or write settings. With no publication, the public RPC returns null.
- Non-admin AAL2 and admin AAL1 sessions cannot use any of the five private editor/mutation RPCs or read private settings rows.
- Admin AAL2 can save/publish; direct table mutation remains denied so it cannot bypass history/revision checks.
- Every preset and every allowlisted enum value passes both validators. Missing fields, unknown keys, markup/URL attempts, invalid schema versions, unsafe font names, invalid hex colors, and failing text/accent contrast are rejected in JavaScript and PostgreSQL.
- Save Draft leaves the public response unchanged. Publish writes configuration and history atomically. Stale revisions fail with a conflict.
- Anonymous publication responses have exactly three keys: configuration, publication version, and publication time. No draft or actor metadata is exposed.
- Revert and version restoration alter only the draft; missing versions are rejected. Earlier published versions remain available.
- The existing 13 database checks for customer submissions, immutable reviews, moderation, RLS, role assignment protection, inquiry handling, cooldowns, and fixed search paths still pass.

### Browser editor and regression tests — passed

Chromium ran the bundled Supabase SDK against intercepted test responses, separate from the SQL tests. Appearance loaded only after the existing login/MFA flow. Preset changes affected the preview without restyling the admin. Save Draft remained private; cancellation prevented publishing; explicit confirmation published. Low-contrast edits disabled saving and retained the last valid preview. Font, header/footer, logo, corner, button, spacing, and animation options affected the preview. Historical restoration and draft reversion left public settings unchanged.

A simulated concurrent revision preserved the user's preview, disabled stale writes, and required reloading. Expanded preview opened and closed with Escape; its content returned to the inline preview. The authenticated editor passed axe WCAG A/AA checks with zero violations and had no horizontal document overflow at 320, 390, 768, 1024, and 1440 px. Desktop and mobile screenshots were visually reviewed.

The existing MFA enrollment/challenge, wrong OTP rejection, non-admin rejection, safe review rendering, approve/feature/verification/response, inquiry status changes, sign-out clearing, public review filters, contact submission, review retry/idempotency, and supplied-MP4 detection tests still pass. No JavaScript page exceptions were observed.

### Delivery and live boundary

The deployed `styles.css`, `js/admin.js`, and `js/api.js` were fetched read-only and matched the original project before the Appearance changes. The existing public configuration was validated as a publishable/anon configuration and preserved in the full archive. The update-only archive excludes it and all existing brand/media assets. No Stripe links, Tally destinations, schema for customer data, Auth user, MFA factor, or account setting was changed.

These are local implementation tests. The safe migration still needs to be run in the owner's existing Supabase SQL Editor and the changed files deployed through the existing repository. No hosted database migration, real-admin login, live appearance publication, payment, or form submission was performed as part of this update.


### Published themes and failure recovery — passed

A further browser pass exercised Premium Hybrid, Light, and Dark on eight representative pages each (24 page/preset combinations), including service content, contact/review forms, public reviews, and legal text. All passed automated WCAG A/AA scans with zero violations and mobile overflow checks. A custom font/style palette was applied; a mid-gray accent correctly received black button text with at least 4.5:1 contrast.

Tests confirmed: no published row uses Premium Hybrid; network failure keeps the default or last safe publication; a cached publication applies before a delayed response; a fresh response replaces it; malformed/expired caches and unsafe server values are rejected; unavailable localStorage causes no rendering failure; and the homepage remains styled, readable, and responsive with JavaScript disabled. This pass ran with browser web security enabled. No JavaScript page exceptions were observed.

A focused final check also verified explicit reversed wordmarks on light header/footer backgrounds, readable light-theme mobile navigation controls, and automatic suppression of a hero grid when a near-threshold text color would lose contrast.
