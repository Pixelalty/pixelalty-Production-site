# Pixelalty security and operations

This document describes implemented controls and their limits. It is not a claim that any website is perfectly secure, externally audited, or already connected to your accounts.

## Architecture and trust boundaries

- Static HTML/CSS/JS handles presentation. It is public, including `admin.html`; that URL is not a secret or an access control.
- Stripe-hosted links handle payment. There are no card fields, payment secrets, or Stripe API calls in the static site.
- Supabase Auth handles administrator passwords and TOTP. The bundled client is version 2.57.4, served locally, with its MIT license.
- Supabase PostgreSQL handles submissions, moderation, and inquiries. All application tables have RLS enabled. Public forms use defined RPCs; anonymous visitors have no direct table access.
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
