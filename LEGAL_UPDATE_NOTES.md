# Pixelalty legal update

Generated September 20, 2026 for the existing production site at https://pixelalty.com.

This is a drop-in legal-content update. The ZIP contains complete files at their existing relative paths. It is an overlay for the existing repository, not a replacement for the entire website folder.

## Exact files in this update

| File | Change and reason |
| --- | --- |
| `terms.html` | Complete replacement: 33 numbered sections covering both service lines, package limits, payment, delays, revisions, media rights, ownership, third parties, AI-assisted tools, delivery, portfolio use, outcomes, disputes, remedies, and Florida governing law. Clean canonical and Open Graph URL. |
| `privacy.html` | Complete replacement: 21 numbered sections describing the inspected Cloudflare Pages, GitHub, Supabase, Stripe, Tally, review, inquiry, authentication, browser-storage, and project-material practices. Clean canonical and Open Graph URL. |
| `refund-policy.html` | Complete replacement: 15 numbered sections consistent with the Terms, including earned work, authorized costs, partial completion, customer delays, duplicate payments, scope disputes, Pixelalty nonperformance, and non-waivable remedies. Clean canonical and Open Graph URL. |
| `sitemap.xml` | Changes only the three legal-page entries to their clean canonical URLs. Other entries are unchanged. |
| `tools/build_site.py` | Updates the optional maintainer generator so a future regeneration retains these policies and clean legal URLs. Hosting does not execute this file. |
| `tools/legal_content.json` | New maintainable policy source used by that generator. Stores the reviewed text, sections, links, and actual update date. Public pages are still complete static HTML; no runtime JSON request is required. |
| `STRIPE_SETUP.md` | Updates its four policy/contact URL references to the clean paths and links to the focused legal setup guide. Existing product, price, checkout, and Tally mapping is unchanged. |
| `STRIPE_LEGAL_SETUP.md` | New exact URL mapping and instructions for the available Stripe policy displays and Terms checkbox. |
| `LEGAL_UPDATE_NOTES.md` | This change list, installation order, operational notes, and validation record. |

No CSS, JavaScript, brand assets, admin page, Supabase configuration, SQL, service pages, contact/review forms, or security rules are changed. All other existing files compare byte-for-byte with the pre-update version. The original header, footer, navigation, stylesheets, Appearance scripts, and Content Security Policy are preserved on all three legal pages.

## Installation order

1. Save a copy of the currently deployed files and the policy version that applies to existing orders. Keep the existing repository and all its other files.
2. Extract `Pixelalty-Legal-Update.zip`. Copy its contents into the existing website repository root, replacing matching files and preserving the `tools/` subfolder. There is no enclosing project folder inside this ZIP.
3. Commit these files together and use your existing GitHub-to-Cloudflare Pages deployment workflow. Keep the current build settings, output directory, domain, redirects, and environment configuration. These complete HTML pages do not require running Python or rebuilding the site.
4. After deployment, open `https://pixelalty.com/terms`, `/privacy`, and `/refund-policy`. Confirm the September 20, 2026 date, new content, and working navigation. Check a phone-sized screen and your selected Appearance theme. Existing `.html` links remain valid through Cloudflare Pages’ HTML URL handling; no new redirect file is needed. Cloudflare documents this behavior in [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).
5. Then follow [STRIPE_LEGAL_SETUP.md](STRIPE_LEGAL_SETUP.md). Website deployment alone does not update the Stripe account or enable acknowledgment on its five checkout links.

**No SQL migration or Supabase action is needed.** Do not rerun the first-install SQL, reset tables, recreate admin users, or change MFA. Existing reviews, inquiries, published/draft Appearance settings, and history are untouched.

For a rollback, restore the replaced files from your backup and redeploy. Keep dated policy copies for orders made under each version; changing the website does not retroactively rewrite those agreements.

## Business rules made explicit

- Launch remains $799 / up to 4 pages / 1 round / estimated 3–5 business days; Growth $1,299 / up to 8 / 2 rounds / 5–7; Premium $1,999 / up to 12 / up to 3 rounds / 7–10. Estimates start after required payment and complete usable inputs. Advanced starts at $2,999 with written custom scope. Listing Video remains $499, authorized supplied photos, one round, and digital delivery.
- A revision is consolidated feedback within scope. Materially expanded features and additional rounds require an approved quote. Corrections of Pixelalty’s own failure to meet scope are not optional paid revisions.
- A missing material response may lead to a hold after 14 calendar days from a written request. After 60 consecutive days without a meaningful response, closure requires a final notice allowing at least 14 additional days. An agreed longer hold takes precedence. Reactivation is separately quoted only when substantial extra work is needed; no automatic penalty applies.
- Cancellation accounting protects properly earned work and authorized, disclosed, nonrecoverable costs. Reserved-time deductions require a specific advance agreement, reasonable unavoidable loss, no double recovery, and a lawful basis. The update does not create a standard booking charge. Unearned balances and appropriate remedies for undelivered work remain available.
- Portfolio use is limited to completed non-confidential work, subject to underlying rights and a written opt-out before publication. Private administration, payment information, credentials, customer lists, confidential documents, and sensitive information are excluded.
- The liability cap and exclusions are qualified by applicable law, with exceptions for fraud, willful misconduct, gross negligence, non-waivable liability, and express refund obligations. Customer indemnity is limited to customer-caused third-party claims and excludes Pixelalty’s share of fault. Honest reviews and lawful disputes remain protected.

Use these rules consistently in quotes, communications, production, and refund decisions. Retain approvals and a clear record of completed work and authorized costs. Do not apply the new terms retroactively to existing orders without a lawful agreement.

## Privacy audit and limits

The policy is grounded in the current source and read-only inspection of the live public site. The public pages do not collect raw card details. Supabase handles inquiries, reviews, admin authentication, and design settings; public review output excludes reviewer email and order references. Appearance caches public design settings locally; admin sessions and public-form cooldowns use browser session storage.

No Google Analytics, Meta Pixel, advertising tags, or Cloudflare Web Analytics beacon were found in the reviewed public deployment. No cookie banner or tracking code was added. External Stripe, Tally, Instagram, and other provider pages have their own practices. Provider privacy links were checked against their official sites.

The website code cannot establish every future offline business practice, provider account setting, retention decision, or production-tool configuration. The published promises must remain accurate as operations change. No new deletion automation, storage guarantee, analytics installation, or provider contract was introduced.

## Validation

The release was checked against `web-design.html`, all four individual website-package pages, `listing-videos.html`, `contact.html`, and `review.html`. Package prices, page counts, revision allowances, conditional timelines, Advanced scope, photo rights, ownership limitations, and public/private review fields align.

Static checks verify all three clean canonical/Open Graph URLs, one H1 per page, numbered sections, unique anchor IDs, internal-link targets, the sitemap, real contact destinations, and rendered links. Existing headers, footers, Appearance scripts, and security metadata compare unchanged. Shared styles, scripts, checkout links, Tally links, admin/MFA, database files, and all nonlegal public pages compare unchanged.

Browser checks passed on all three legal pages in Premium Hybrid, Light, and Dark at 320, 390, 768, and 1440 pixels: 36 page/theme/width combinations without horizontal overflow or broken images. Ten automated WCAG A/AA scans reported no violations; no JavaScript page errors were recorded. In-page navigation, the mobile menu, default-theme fallback, and readable static content without JavaScript passed. Desktop and mobile screenshots were visually reviewed. These checks do not certify complete accessibility or legal compliance.

Read-only requests confirmed that the homepage, contact page, four package-detail URLs, and three clean legal URLs return successful HTML responses. All three legacy `.html` legal URLs redirect to their intended clean paths. This verifies existing production routing, not publication of the replacement content.

The replacement content has not been deployed to production and no authenticated Stripe, Supabase, or hosting settings were changed during preparation. Checkout acknowledgment and production deployment must be verified after installation.

## Drafting references and legal status

The policies are original business-policy drafts, **not attorney-reviewed**, and do not guarantee enforceability or compliance in every jurisdiction. A Florida attorney can assess the actual contracting entity, customer locations, business practices, and limitations before adoption. No entity name, address, email, phone number, employee count, or county-specific venue was invented.

The narrow review provisions follow the principle that consumer contracts should not suppress lawful honest reviews or take ownership of them: [FTC Consumer Review Fairness Act guidance](https://www.ftc.gov/business-guidance/resources/consumer-review-fairness-act-what-businesses-need-know). Photo permissions are treated separately from possession of an image: [U.S. Copyright Office guidance for photographers](https://www.copyright.gov/engage/photographers/). Retention and security commitments use the minimum-needed, safeguarded-data approach described in [FTC Protecting Personal Information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business). These references inform specific drafting choices and are not a legal opinion on the full agreement.
