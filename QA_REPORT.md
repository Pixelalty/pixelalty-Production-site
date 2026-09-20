# Pixelalty website QA report

Prepared September 20, 2026. This report distinguishes tests completed locally from checks that need the owner's real accounts and production domain.

## Delivered

16 complete HTML pages: home; Web Design overview; Launch, Growth, Premium, and Advanced detail pages; Listing Videos; Reviews; Leave a Review; About; Contact; Terms; Privacy; Refund Policy; 404; and Admin. Also included: shared responsive styles, modular JavaScript, original and optimized branding, 1200×630 Open Graph image, favicon assets, manifest, sitemap, robots.txt, CNAME, .nojekyll, optional host headers, Supabase setup SQL, and setup/security guides.

No site is represented as deployed. Supabase public configuration is intentionally empty. No real credentials, customer records, fabricated testimonials, or fabricated listing demo are included.

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

- Create the actual Supabase project, run SQL once, disable signup, create your admin, assign the profile role, enable TOTP, and add the public URL/key.
- Verify real authentication, MFA enrollment/challenge, RLS, CORS, account recovery, and form persistence in your own Supabase project. Local tests are not a hosted penetration test.
- Confirm each live Stripe product/amount, account activation, policy acceptance, receipt behavior, tax treatment, and exact after-payment redirect in Stripe. The public research tool could not open the supplied checkout URLs; their strings were verified against the brief, but live checkout contents and transactions were not tested. No payment was made and no Stripe setting was changed.
- Confirm your actual Tally questionnaires and existing listing-video fulfillment flow. No questionnaire has been replaced.
- Publish, configure DNS/HTTPS, and test HTTP headers on the actual host. GitHub Pages' commercial-use limitations are documented in README_SETUP.md; technical file compatibility is not permission to use that service for this business.
- Review business/legal policies for your real practices and selected providers. They are practical drafted terms, not an attorney-review claim. Update the hosting provider named in Privacy before launch.
- Upload the real authorized `assets/listing-video-demo.mp4` later and verify playback on actual mobile devices; captions/rights depend on the final footage.
- Check the dashboard for inquiries; automatic email notifications are not configured.
- Monitor abuse and quotas. Per-email rate limiting is implemented, but no CAPTCHA, IP firewall, or verified-email submission is claimed.

See README_SETUP.md for the complete A–R launch steps and STRIPE_SETUP.md for the five-link checklist.
