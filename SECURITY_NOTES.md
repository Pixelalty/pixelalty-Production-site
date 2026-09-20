# Pixelalty security and operations

This document describes implemented controls and their limits. It is not a claim that any website is perfectly secure, externally audited, or already connected to your accounts.

## Architecture and trust boundaries

- Static HTML/CSS/JS handles presentation. It is public, including `admin.html`; that URL is not a secret or an access control.
- Stripe-hosted links handle payment. There are no card fields, payment secrets, or Stripe API calls in the static site.
- Supabase Auth handles administrator passwords and TOTP. The bundled client is version 2.57.4, served locally, with its MIT license.
- Supabase PostgreSQL handles submissions, moderation, inquiries, and validated appearance settings. All application tables have RLS enabled. Public forms use defined RPCs; anonymous visitors have no direct table access.
- `profiles.role` determines administration and is not writable by clients. Private reads, changes, and deletion require both this role and a server-verified JWT `aal2` claim. The pre-MFA identity RPC only answers whether the current user has an admin role, allowing enrollment without exposing private data.
- Every SECURITY DEFINER routine sets a fixed empty search path and uses schema-qualified application objects. Privileges are revoked from PUBLIC and explicitly granted only where needed.

## Review integrity and privacy

`get_public_reviews` returns only approved reviews and a named set of public-safe columns. It cannot return email, order reference, moderation reason, request ID, or a profile record. Public callers cannot select the base table or invoke internal rate-limit functions. Public count is a scalar count of approved rows only.

Submitted reviews are forced to pending/unverified/unfeatured. Client-supplied status, verification, feature, response, or moderation fields are ignored. Admin UPDATE grants are restricted to moderation fields. A trigger additionally prevents changes to review identity, text, title, rating, email, service, reference, consent, and creation date. Corrections require deletion and genuine customer resubmission. Hiding requires a reason; verification asks the admin to confirm comparison to actual business records. The public interface explains selection and moderation and does not claim every submitted review is published. Real positive and negative experiences should be treated consistently. [FTC review guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).

## Submission protection

Both public submission functions validate request shape and byte length, allowed service, field lengths, email shape, form age, honeypot, and required review confirmation. They return a boolean acknowledgement, not private records. Client request UUIDs make successful retry submissions idempotent. PostgreSQL advisory locks serialize identical request IDs and rate-limit keys to reduce concurrency races.

Per normalized email and submission kind, the database enforces a 60-second cooldown plus a daily cap: 5 reviews or 10 inquiries. An internal random salt hashes email-based limiter keys. Limiter rows older than seven days are cleaned on later submissions. Browser cooldowns are an extra UX measure only; local storage is not trusted for enforcement.

This is not verified-email submission, CAPTCHA, IP-based throttling, malware scanning, or comprehensive denial-of-service defense. Form timing and honeypots can be bypassed by determined automation; rotating email addresses can bypass per-email quotas. Monitor volume, Supabase quotas, and moderation queues. If needed, add a server-verified CAPTCHA and request rate limiting behind a dedicated Edge Function; never add a service-role key to the browser. No such external service is represented as active in this delivery.

## Browser security

- Customer content is rendered with DOM `textContent` and text nodes, never injected HTML. Public links are fixed local/known URLs; the only accepted preselected service values are allowlisted.
- The admin QR code is loaded as an image; no untrusted SVG is inserted into the document as markup.
- A restrictive meta CSP allows local scripts/styles/fonts/assets and the `*.supabase.co` API. No `eval`, inline event handlers, iframe embeds, or remote JavaScript dependencies are required. JSON-LD is inert structured data.
- The `_headers` file adds HTTP `frame-ancestors 'none'`, frame blocking, MIME sniffing protection, referrer policy, permissions restrictions, and no-store for admin when deployed on a supporting static host. **GitHub Pages does not apply custom `_headers`.** Meta CSP cannot enforce frame-ancestors. Verify response headers on the selected production host rather than assuming a file applies them.
- `noindex,nofollow` prevents intended search indexing of workflow pages; it does not provide authentication.
- Admin tokens use sessionStorage instead of persistent localStorage. The tab is signed out after 15 minutes without activity and on explicit sign-out. JavaScript-accessible storage is vulnerable if same-origin script execution is compromised. Use HTTPS, protect the repository, keep dependencies maintained, and never paste arbitrary scripts into the admin console.
- Supabase token expiration, refresh, revocation, and account recovery remain controlled by Supabase. Local sign-out removes the current browser session; token expiry behavior is governed by the backend. If compromise is suspected, revoke sessions through your project-owner controls.

## Owner setup and operational checks

Disable public signup and unused identity providers. Create the administrator manually, assign its protected profile role, enable TOTP enrollment/verification, and complete MFA before the first private data access. Protect your GitHub, registrar, Stripe, and Supabase owner accounts with unique passwords and MFA. Manage lost-factor recovery using the secured Supabase owner dashboard and revoke existing sessions; do not relax RLS.

No email notification service, scheduled deletion job, payment-webhook customer verification, analytics, tracking pixels, newsletter service, or recurring maintenance service is active in this implementation. The administrator should check inquiries regularly and implement the stated retention practices. Rate-limit cleanup happens on subsequent submissions, not on a clock. Review provider logs, data-region settings, backups, spending limits, and security advisories appropriate to actual usage.

## After connection: verify the real deployment

1. Anonymous requests to base `reviews`, `contact_inquiries`, and `profiles` tables must be rejected.
2. Pending and hidden reviews must be absent from `get_public_reviews`; public responses must have no email/reference fields.
3. Public submitted status/verification/feature values must not take effect.
4. A non-admin authenticated user must receive no private rows, even with MFA.
5. An admin with password-only AAL1 must receive no private rows; the same admin at AAL2 must be able to moderate.
6. AAL2 admin attempts to change body/rating/identity must be denied; allowed moderation changes must succeed.
7. Confirm a bad password and wrong OTP produce generic errors, signing out hides private data, and the next login requires the correct factors.
8. Confirm real Supabase CORS/connectivity, HTTP response headers, and the final domain. Local QA does not substitute for these account-specific checks.

Implementation references: [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa), [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).


## Appearance security and migration

`supabase/ADD_APPEARANCE_EDITOR.sql` is the only file required for the live upgrade. It is transactional and repeatable. It checks that the existing protected admin helper is present and adds only Appearance objects. It never drops/recreates existing tables, updates customer rows, grants new access to profiles, changes the admin role helper, resets Auth, or alters TOTP factors. `SUPABASE_SETUP.sql` remains a first-install base file and explicitly directs live installations to the separate migration.

`site_settings` is a single protected row containing published configuration, private draft, revision, publication version, timestamps, and the last actor UUID. `site_settings_history` keeps publication snapshots and publishing metadata. Both tables have RLS enabled. Anonymous callers receive no direct table privileges. Authenticated direct reads require the existing `profiles.role = 'admin'` and JWT `aal2` predicate. Authenticated clients have no direct INSERT/UPDATE/DELETE grants, so they cannot bypass validation, revision checks, or history by calling the table API.

The narrowly projected SECURITY DEFINER `get_published_appearance()` is the only anonymous appearance read surface. It has no input parameters and returns only the current published configuration, publication version, and publication time (or null). It never returns a draft, history, profile, actor UUID, email, or customer/admin data. RLS is not loosened to expose the mixed private/public base row.

Private editor/read/mutation RPCs are granted only to authenticated users and each explicitly checks the protected admin + AAL2 helper. Mutations validate configuration, lock the singleton row, compare the expected revision, and change only Appearance data. Concurrent stale requests receive `APPEARANCE_CONFLICT`. Publication stores the configuration and its immutable-to-clients history entry in one transaction. Restore copies an existing history version to the draft; only the separate publish RPC makes it public. The editor displays a confirmation before calling publish. This confirmation is a deliberate UI step, not a claim that a legitimately authorized administrator cannot call the RPC directly.

Every Appearance SECURITY DEFINER routine uses an empty fixed search path and qualified application objects. PUBLIC privileges are explicitly revoked; grants name only the required roles/functions. Internal validators have no browser execution grants. Database CHECK constraints and mutation routines both require the closed schema. The private schema must remain unexposed in the Data API.

Configuration has exactly 21 known keys and schema version 1, a bounded 4 KB representation, seven six-digit hex colors, and explicit enum allowlists. No HTML, JS, CSS declarations/selectors, URLs, font URLs, asset paths, or arbitrary property names can be stored by the editor/RPC. The browser independently validates the same schema, colors and contrast and uses `style.setProperty` only with fixed property names and mapped trusted values; it does not insert database text into a stylesheet or markup. Primary/muted text must reach 4.5:1 against all configurable surfaces. Accent must reach 3:1; normal text accents fall back to the primary text when necessary, button text is derived for 4.5:1, and form/focus borders use contrasting tokens. Decorative card borders are not used as the sole control boundary.

Header/footer palettes, decorative mockups, and the original artwork use controlled contrast-safe surfaces. The homepage hero and closing CTA derive safe text/accent values. The four fonts are fixed, local/device font stacks; there are no remote font fetches. Reduced-motion CSS overrides all animation settings. Hero texture overlays are sampled against hero text colors and suppressed when the contrast margin would become insufficient.

The editor's representative preview uses a Shadow DOM containing a static trusted template and the public stylesheet. Database values only update validated tokens on its root. There is no arbitrary HTML editor, iframe, remote preview URL, `srcdoc`, cross-window message listener, or relaxation of frame-ancestor protection. Private preview/draft state is reset at sign-out, and generation guards ignore late asynchronous responses after a session clears. MFA is checked again before every editor RPC; the database is the authorization boundary.

Only validated **published** configuration is cached in localStorage with a version and 24-hour expiry. Cache contents are treated as untrusted and validated again before use. Drafts/history/actor metadata never enter this cache. Browsers without storage or JavaScript retain the CSS fallback. This cache is a presentation optimization, not an authorization mechanism. A published change may take up to the next 60-second visible-page refresh to reach an already-open tab. No service-role key is used by any browser module.

For production acceptance: apply the migration to the existing project; sign in through the existing MFA flow; save a distinguishable draft and confirm an anonymous window still sees the old publication; confirm Publish; verify the anonymous output contains only the three safe public fields; restore a version into draft; and verify an AAL1/non-admin session cannot access the editor RPCs. The local SQL/browser results are detailed in QA_REPORT.md; no hosted database mutation or real-account login was performed while building this update.
