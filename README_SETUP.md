# Pixelalty website — start here

Your completed site is plain HTML, CSS, and JavaScript. All 16 pages are already generated. **No build, React, Node server, or paid website theme is required.** The five supplied brand images are preserved in `assets/brand/`; optimized web versions and exact cropped logo elements are also included. Stripe links and existing Tally redirects are preserved.

This update adds **Appearance** to the existing secured admin dashboard and a Premium Hybrid public design. The full archive retains the public Supabase configuration read from your deployed site. No password, service-role key, or private customer data is included. Your current GitHub → Cloudflare Pages structure and checkout destinations are preserved.

## Update your LIVE Pixelalty site — start here

**Do not repeat the first-install steps below. Do not rerun `SUPABASE_SETUP.sql`, recreate your administrator, reset MFA, or delete any existing tables.**

1. In your existing Supabase project, open **SQL Editor → New query**. Paste and run **`supabase/ADD_APPEARANCE_EDITOR.sql` only**. This transaction adds Appearance tables, validation, narrow RPCs, and RLS. It is safe to rerun and preserves reviews, inquiries, profiles, Auth users, and MFA. It does not publish a design automatically.
2. Extract **`Pixelalty-Appearance-Update.zip`**. Merge the contents of its `pixelalty-production-site` folder into the same level of your existing GitHub repository where `index.html` lives. Commit the changed files together. The update archive deliberately omits `js/config.js` and existing assets: keep your live configuration, logos, uploads, and any listing demo. Do not replace the entire repository with the smaller update archive.
3. Let your existing Cloudflare Pages deployment finish. Keep the same framework/build/output settings; no Node server or new hosting service is needed. Open your existing `/admin` or `/admin.html`, sign in with your current account, and complete the current TOTP challenge.
4. Choose **Appearance**. Start with **Premium Hybrid**, inspect desktop/mobile preview, then **Save Draft** or **Publish changes → Confirm & Publish**. A successful Save Draft never changes public settings. Publishing applies to the next public page load; open pages check again every 60 seconds while visible and when revisited.
5. Open the public home, service, contact, and review pages on desktop and phone. With no published appearance yet, the deployed CSS immediately supplies Premium Hybrid. A backend outage cannot remove the site's styling.

The updated `pixelalty-production-site.zip` is the full source archive. For this live upgrade, prefer the smaller update archive so your current config and uploaded assets are retained. If using the full archive, preserve your current `js/config.js` and any files you added after the original build.

## Appearance: everyday use

- **Theme preset:** Premium Hybrid, Light, Dark, or Custom. Changing an individual setting switches the label to Custom. Premium Hybrid uses a dark hero/header and footer, warm light content, white cards, and restrained blue.
- **Palette:** page, section, and card surfaces; primary and muted text; accent; decorative border. Colors are exactly six-digit `#RRGGBB`. Both text colors must meet 4.5:1 on all three content backgrounds. Accent must meet 3:1; button text and accent-colored body text are safely derived. Failed checks prevent saving/publishing and retain the last valid preview.
- **Style:** header Light / Dark / Transparent Hero; footer Light / Dark; Flat / Outlined / Elevated cards; Soft / Medium / Strong borders; None / Subtle / Medium shadows; Minimal / Medium / Rounded corners; Solid / Outline / Soft buttons; Clean / Soft light / Architectural grid hero; Compact / Normal / Spacious spacing; Off / Subtle / Full motion. Operating-system reduced motion always takes precedence. Hero textures are automatically suppressed if they would weaken text contrast.
- **Brand:** Automatic, original dark lettering, or reversed light lettering using the supplied Pixelalty wordmark. Explicit variants retain their contrast-safe backing; automatic variants adapt to the header/footer. All tier graphics remain intact.
- **Typography:** locally hosted Manrope, system sans, Trebuchet/Arial, or Georgia. These are fixed stacks; there is no remote font URL, font upload, HTML, JavaScript, or raw CSS input.
- **Preview** opens the larger design preview. The inline preview scrolls independently; the view selector switches its width. It is a representative layout using the same public stylesheet and token engine. It is isolated from the admin controls and cannot submit forms or navigate. Check real pages after publishing for final copy/layout.
- **Save Draft** saves private settings in Supabase. Unsaved edits live only in the current admin tab and are cleared at sign-out. Drafts are not put in persistent browser storage or served to anonymous visitors.
- **Publish changes** opens an explicit confirmation. Only a confirmed, successful server response is reported as published. Publication creates a numbered history entry in the same transaction.
- **Revert to Published** discards the saved/unsaved draft after confirmation. Before the first publication it returns to the built-in default. It never republishes by itself.
- **Restore Previous Version** restores a selected prior publication into the draft after confirmation; preview and confirm Publish separately. The editor lists the latest 20 publications; the database retains every version.
- **Reload saved settings** fetches the latest revision. If another tab has saved newer settings, stale saves are rejected instead of overwriting them. Your preview remains visible until you choose to reload.

### Appearance troubleshooting

If the editor says Appearance is not installed, run the separate migration in the existing project, then choose Reload saved settings. Do not rerun the base setup. If a save or publish response is uncertain, reload saved settings to see whether it committed before trying again. If your session expires, sign in and verify MFA again.

Visitors use a validated last-published cache for up to 24 hours, applied before CSS to reduce wrong-theme flashes. Fresh published settings replace it after a successful request. If settings are unavailable, invalid, or missing, the site keeps a safe cached design or its complete built-in theme. A successful empty response clears an old cache. Storage denial and disabled JavaScript still leave a fully styled public site. Public pages load only `get_published_appearance`; private drafts/history are available only after admin + AAL2 verification.

## First installation only

The remaining A–R guide is for a completely new deployment. Existing live installations should use the migration procedure above.

## Choose your host before launch

The files are technically compatible with GitHub Pages, as requested. However, **GitHub says Pages may not be used as free hosting for an online business or a site primarily facilitating commercial transactions**, and advises against sensitive transactions such as passwords. This is a sales website with payment CTAs and an administrator login. Do not assume that moving checkout to Stripe makes the business site exempt. Obtain GitHub's confirmation before using Pages for this purpose, or use a suitable commercial static host while keeping the source repository on GitHub. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

A GitHub repository connected to Cloudflare Pages can serve these same static files. See the alternative publishing route below. Hosting requirements do not change the Stripe links or Supabase setup. Check the selected plan's current commercial terms and quotas before launch.

## A. Download and extract

1. Download `pixelalty-production-site.zip`.
2. On Windows, right-click it → **Extract All**. Open `pixelalty-production-site`.
3. You should see `index.html`, the other `.html` pages, `styles.css`, `assets`, `js`, and `supabase` at this level. Do not upload the ZIP as your website.
4. Keep the source folder as your editable master. Opening HTML by double-click is not a complete test: JavaScript modules and forms need an HTTP/HTTPS website. Use the preview or publish to a temporary static host URL first.

## B. Create Supabase

1. Visit [Supabase](https://supabase.com/dashboard) and sign in to your own account.
2. Create an organization if asked, then choose **New project**.
3. Name it `Pixelalty`. Choose a region appropriate for your customers and save the database password in your password manager. This password never belongs in the website.
4. Wait for the project to finish provisioning. Keep this project dedicated to the site so its permissions are easy to audit.

## C. Install the database

1. In that project open **SQL Editor** → **New query**.
2. Open `supabase/SUPABASE_SETUP.sql` in a text editor.
3. Copy the entire file into SQL Editor and click **Run**, then run `supabase/ADD_APPEARANCE_EDITOR.sql` in a separate query to install Appearance.
4. The script creates protected tables, read-safe public review functions, validated submission functions, and database authorization. It contains no example customer reviews.
5. This is a **first-install script for a new project**. Do not run it on top of an existing installation or drop live tables to make it run. Back up and use a reviewed migration for later schema changes.
6. Leave `pixelalty_private` out of Supabase's exposed Data API schemas. The default `public` schema is all the browser needs.

## D. Submission functions

No Edge Functions, CLI deployment, service-role key, CAPTCHA service, or extra server is required for this version. The SQL installs:

- `submit_review(payload)` and `submit_contact(payload)` for public submissions.
- `get_public_reviews(...)` and `public_review_count()` for approved, public-safe review information.
- `admin_identity()` to check the signed-in user's protected administrator role before enrolling or challenging MFA.

All public submissions are validated in PostgreSQL. Reviews are forced to pending, unverified, and unfeatured. Contact inquiries are forced to new. Private table reads are unavailable to anonymous visitors. Email and order-reference fields are absent from public review responses. Abuse protection includes honeypot, minimum completion time, payload/field limits, idempotent retries, a 60-second per-email cooldown, and daily per-email caps (5 reviews / 10 inquiries). It is basic protection, not a full bot firewall; changing email addresses can evade per-email limits. Monitor abuse before adding an Edge Function with server-verified CAPTCHA or an upstream rate limiter.

## E. Create your administrator manually

1. In Supabase open **Authentication** → **Users**.
2. Choose **Add user** → **Create new user** (dashboard wording may vary).
3. Enter your real administrator email and a strong unique password. Use the confirmed/auto-confirm option for an account you control, if shown.
4. Create the user, open its row, and copy its **User UID**. It is a UUID such as `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, not the email.
5. Do not put this password or a secret key in GitHub, this chat, the website, or `config.js`.

## F. Disable public signup

1. Open **Authentication** → **Sign In / Providers** (or the Authentication configuration area).
2. Disable **Allow new users to sign up**. Disable anonymous sign-ins and providers you are not using.
3. Keep Email/password sign-in enabled for the manually created account.
4. Under **URL Configuration**, set Site URL to `https://pixelalty.com`. Do not add wildcard redirect URLs. This implementation has no public signup, magic-link callback, or browser password-reset flow.
5. Protect your Supabase owner account itself with MFA. A project-owner account can administer the database, so its security matters too.

## G. Assign the administrator role

1. Open a NEW query in SQL Editor.
2. Paste the statement below and replace only `PASTE-YOUR-USER-UID` with the actual UUID from Step E:

```sql
insert into public.profiles (user_id, role)
values ('PASTE-YOUR-USER-UID', 'admin');
```

3. Run it. The browser cannot assign or change this role. Do not add public insert/update policies to `profiles`, and do not use user-editable metadata for authorization.
4. You can verify the row in the Supabase Table Editor as project owner. The public site cannot read the profile list.

## H. Enable TOTP MFA

1. In Supabase Authentication's MFA settings, allow **TOTP / App Authenticator enrollment and verification**. Do not select Verification Disabled.
2. After setting configuration and hosting in the next steps, visit `https://pixelalty.com/admin.html` directly. It is intentionally absent from public navigation.
3. Sign in with the account from Step E.
4. On first sign-in, the site displays an authenticator QR code and a setup key. Add it to your authenticator app, preserve a secure backup, and enter the current six-digit code.
5. On later sign-ins, enter the current code when prompted.
6. The database requires an admin role **and** an `aal2` session for every private read or change. Merely hiding the dashboard is not the security boundary.
7. Recovery: if you lose the authenticator, sign in to the secured Supabase project-owner dashboard, use the affected user's MFA administration to remove/reset the factor, and revoke the user's sessions. Then sign in to the site and enroll a new factor. Never disable the database MFA requirement as a workaround. UI wording may vary; follow the current Supabase recovery controls.

## I–K. Add ONLY the two public Supabase values

1. Find **Project URL** in the project's Connect dialog or Settings → Data API / API. It should look like `https://your-project-reference.supabase.co`.
2. Find the **publishable key** under Settings → API Keys (starts with `sb_publishable_`). A legacy **anon** key is also supported. Do not choose `service_role`, `sb_secret_...`, a database password, or an administrator password.
3. Open `js/config.js` in a plain-text editor.
4. Replace the two empty values below, leaving the quotation marks:

```js
supabaseUrl: 'https://your-real-project-reference.supabase.co',
supabasePublishableKey: 'your-actual-publishable-or-legacy-anon-key',
```

5. Save. The file contains only public configuration. A public key does not grant administrator access; SQL permissions do that.
6. If you later acquire a business email, set `contactEmail` in this file. It will appear on the contact page and footer automatically. Leave it empty until an actual address exists.
7. Use the default `*.supabase.co` project endpoint. If you later use a custom Supabase hostname, a developer must update endpoint validation and the CSP `connect-src` allowlist together.

## L–M. Upload and commit to GitHub

1. Create or open the repository you intend to use. Back up any existing site before replacing it.
2. Choose **Add file** → **Upload files**.
3. Drag the contents of `pixelalty-production-site` into the repository root so `index.html` is at the top level. Do not add an extra folder around the site.
4. Include `assets`, `js`, the policy pages, `CNAME`, and `.nojekyll`. If your upload method hides `.nojekyll`, use GitHub's **Create new file** and name it `.nojekyll`; an empty file is sufficient.
5. Commit with a message such as `Add Pixelalty website`.
6. `README_SETUP.md`, `STRIPE_SETUP.md`, `QA_REPORT.md`, `SECURITY_NOTES.md`, `supabase`, and `tools` contain public implementation documentation, not secrets. They can be kept in the source repository. The config contains only public settings and a browser-safe Supabase key. No Node installation is needed to host the site.

## N. Publish and connect pixelalty.com

### Commercial-host route: GitHub → Cloudflare Pages

1. In your Cloudflare dashboard go to **Workers & Pages** → **Create application** → **Pages** → **Import an existing Git repository**.
2. Connect the GitHub repository from Step L.
3. Use **Framework preset: None**, **Production branch: main**, **Build command: `exit 0`**, **Build output directory: `.`** when the site files are at repository root. There is no framework build.
4. Deploy and open the supplied temporary preview URL. Do not announce the site to customers until the checklist below passes.
5. Under the project's **Custom domains**, add `pixelalty.com`. Follow Cloudflare's ownership/DNS instructions for your registrar; do not guess DNS records or remove unrelated email records. Add `www.pixelalty.com` as an optional alias and redirect it to the canonical apex domain if desired.
6. Confirm HTTPS works. The included `_headers` applies additional security headers on hosts that support that format. GitHub Pages ignores it.
7. Update the Privacy Policy's hosting description to identify your actual host before launch. The supplied policy deliberately describes compatibility rather than claiming a deployment has happened.

[Cloudflare static HTML instructions](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

### GitHub Pages route, only if GitHub confirms your intended use is permitted

1. Repository **Settings** → **Pages** → **Build and deployment** → **Deploy from a branch**.
2. Choose `main` and `/(root)`, then Save.
3. Set Custom domain to `pixelalty.com`. The included `CNAME` already contains that name.
4. At your domain registrar, configure the apex A/AAAA or supported ALIAS/ANAME records using GitHub's current instructions. For a `www` alias, use the actual account's `username.github.io` hostname. Do not put the repository name in DNS. Preserve existing email-related records.
5. Verify domain ownership using GitHub's provided TXT record where requested. Remove conflicting old web-host records only after identifying them.
6. Wait for DNS verification and the HTTPS certificate, then enable **Enforce HTTPS**.
7. A repository subpath can preview most pages because normal links are relative. Canonicals, `CNAME`, sitemap URLs, and the root 404 fallback deliberately target `https://pixelalty.com` as requested.

[GitHub custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

## O. Confirm your real workflows

1. Open every page on desktop and your phone.
2. Confirm Launch $799, Growth $1,299, Premium $1,999, Advanced starting at $2,999, and Listing Video $499.
3. Open each Stripe checkout; confirm product, currency, price, and intended payment type in your account. Merely clicking does not charge you. Do not make an accidental live purchase for testing.
4. Use an appropriate Stripe test-mode workflow to verify actual payment and redirect behavior. The supplied live links have not been used to make a transaction.
5. Submit one clearly labeled internal test inquiry and one internal review. Verify receipt in admin and that the review is pending, not public.
6. In your own setup test, confirm a one-star review can be published without changing its text, emails never appear publicly, verification is manual, and hiding removes the review. Delete internal test records afterward; never publish them as customer testimonials.
7. Check signed-out access and a non-admin account if you use one: private records must remain unavailable. Confirm first-login enrollment and later TOTP challenge against your actual Supabase project.
8. Check the dashboard regularly. This version saves inquiries; it does **not** automatically email you about them. Email notifications are not configured or claimed.

## P. Configure Stripe policies

Follow `STRIPE_SETUP.md` for all five Payment Links. Account settings and redirect configuration cannot be changed by these static files. Read the supplied policies before accepting them as your business policies; they must match your actual scope, providers, and refund practices. They are not represented as attorney-reviewed documents.

## Q. Submit the sitemap

1. After the custom domain is live, add/verify `pixelalty.com` in [Google Search Console](https://search.google.com/search-console).
2. Open **Sitemaps** and submit `https://pixelalty.com/sitemap.xml`.
3. The sitemap includes public indexable pages. It excludes `admin.html`, `review.html`, and `404.html`, which use noindex. `robots.txt` permits fetching so search engines can see those noindex instructions. Noindex is not access control.
4. Indexing, ranking, or Search Console acceptance is not guaranteed.

## R. Add the listing demo later

1. Export an actual, authorized demo as **`listing-video-demo.mp4`**, ideally MP4 with H.264 video and AAC audio for broad compatibility. Use a web-optimized file and appropriate rights for music and photos. If it contains speech, include accessible captions in the final video or have a caption track added.
2. Put it in **`assets/listing-video-demo.mp4`**, with the filename and capitalization exactly as shown.
3. Upload/commit it through your normal publishing workflow.
4. Refresh `listing-videos.html`. It checks for the file automatically, waits for usable video metadata, and replaces the demo placeholder. No HTML, JavaScript, or configuration editing is needed. The file must be served with a video MIME type (normal `.mp4` static hosting does this).
5. No demo file or property footage has been fabricated. Until the file exists, a background HEAD request may receive an expected 404 while the designed placeholder remains visible.
6. Respect your host's file-size limits. A GitHub web upload or static-host upload may have a lower file limit than a Git push. Compress the video to fit the chosen host; changing to an external video host would require updating the implementation.

## Everyday administration

Go directly to `/admin.html`. Overview metrics use real database counts. Reviews: choose Pending / Published / Hidden; approve, hide with a reason, delete, verify after checking records, feature/unfeature, or add a public Pixelalty response. Customer review words, titles, identities, and ratings cannot be rewritten. Appearance controls the public design with draft, preview, confirmed publication, and version restoration. Contact inquiries: choose New / Read / Archived, change status, or delete. Lists paginate in groups of 20.

The homepage shows at most three featured approved reviews. The full reviews page loads 12 at a time and filters by service. There is no fabricated rating schema. Sign out when finished. A tab-scoped session is used; the app signs out after 15 minutes without activity. Existing token lifetimes and revocation are also governed by Supabase.

## Maintenance

Keep an offline copy of the site and export/backup your Supabase data as appropriate. Update public copy to reflect real service changes. Check third-party dependency security advisories before version upgrades. `tools/build_site.py` is an optional authoring source for all HTML pages; direct HTML edits work without it, but rerunning it overwrites generated HTML. If you use the generator, edit that source as well. CSS and JavaScript live in their own files. The shipped site is already built.

See `QA_REPORT.md` for what was actually tested and what still requires your accounts, and `SECURITY_NOTES.md` for implementation boundaries and verification instructions.
