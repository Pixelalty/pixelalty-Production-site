# Add Appearance to the live Pixelalty site

Your existing administrator, authenticator, reviews, inquiries, payments, and questionnaire redirects remain in place.

1. Open your **existing Supabase project → SQL Editor → New query**. Run the complete **`supabase/ADD_APPEARANCE_EDITOR.sql`** file. It is a safe, repeatable migration and does not delete or reset existing data.
2. Extract **`Pixelalty-Appearance-Update.zip`**. Open its `pixelalty-production-site` folder. Merge those files and folders into the **root of your existing GitHub repository**, beside the existing `index.html`. Commit the changes together. Keep all other repository files.
3. Let your current **Cloudflare Pages** project redeploy. Keep the same project, domain, build settings, and Supabase connection.
4. Open your existing **`/admin`** (or `/admin.html`). Sign in and complete your current authenticator challenge. Select **Appearance**.
5. Choose a preset or customize the controls. Use the desktop/mobile preview. **Save Draft** stays private. **Publish changes → Confirm & Publish** makes the design public.

**Do not run `SUPABASE_SETUP.sql` on the live database. Do not recreate your admin or reset MFA.** The first-install file is included only for a future new installation.

The update ZIP contains changed files only. It intentionally omits `js/config.js`, the existing assets, and uploaded media. Do not deploy the update ZIP as an otherwise empty site or delete unchanged repository files. It uses your existing official logos and local font assets.

The full `pixelalty-production-site.zip` is also updated. If using it instead, retain any newer config/media/custom files in your live repository. The full archive contains the browser-safe public Supabase configuration retrieved from the existing deployed site, never an admin password or service-role key.

With no published design, the new frontend renders the complete Premium Hybrid default. An unavailable database, invalid response, or empty settings table cannot produce a blank or unstyled site. A valid recent published theme can be used from cache; open pages refresh settings about once a minute while visible.

Revert to Published discards the draft after confirmation. Restore Previous Version puts an earlier publication into a private draft; publish it separately after review. If another tab saved a newer revision, reload saved settings before saving again. If a request fails after being sent, reload first to see whether the server committed it.

The editor enforces text contrast, supported color formats, and fixed option/font lists. No raw HTML, CSS, JavaScript, remote fonts, or replacement logo editor is available. See `README_SETUP.md`, `SECURITY_NOTES.md`, and `QA_REPORT.md` for the full controls, migration/security details, and tests.

This package does not itself execute SQL or deploy files to your accounts. Apply the two update steps above to activate it.

## Exact file changes

Each listed file is supplied complete. Replace the matching file; no line-by-line code merge is required. All public page filenames and routes are retained.

### Existing files replaced

- `404.html`
- `QA_REPORT.md`
- `README_SETUP.md`
- `SECURITY_NOTES.md`
- `about.html`
- `admin.html`
- `contact.html`
- `index.html`
- `js/admin.js`
- `listing-videos.html`
- `manifest.webmanifest`
- `privacy.html`
- `refund-policy.html`
- `review.html`
- `reviews.html`
- `styles.css`
- `supabase/SUPABASE_SETUP.sql`
- `terms.html`
- `tools/build_site.py`
- `web-design-advanced.html`
- `web-design-growth.html`
- `web-design-launch.html`
- `web-design-premium.html`
- `web-design.html`

### New files added

- `APPEARANCE_UPGRADE.md`
- `appearance-admin.css`
- `appearance-preview.css`
- `js/appearance-admin.js`
- `js/appearance-core.js`
- `js/appearance.js`
- `supabase/ADD_APPEARANCE_EDITOR.sql`
- `tools/appearance-panel.html`

### Existing files retained

`js/config.js`, all files under `assets/`, the other JavaScript modules and bundled SDK, `_headers`, `CNAME`, `.nojekyll`, `robots.txt`, `sitemap.xml`, and the Stripe/asset guides are not included in the update-only archive. Keep them in your existing repository.
