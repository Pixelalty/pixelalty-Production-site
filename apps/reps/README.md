# Pixelalty Sales

Independent application for reps.pixelalty.com. This is a work-in-progress recovery branch, not a production release. The earlier unsaved local build was lost during a workspace reset. This branch preserves replacement source as it is rebuilt.

The existing customer website stays at the repository root. This app has its own package manifest, build, deployment, and additive database migrations under `apps/reps`; the public site's files are not modified. A separate repository can be created by copying this directory without changing its runtime paths.

GitHub access and the existing Pixelalty Supabase project have been verified. No migrations or deployments have been applied. Cloudflare hosting and Stripe sandbox credentials still require account-side setup after validation.

Required default sale / commission amounts in USD: Launch $799 / $125; Growth $1,299 / $250; Premium $1,999 / $400; Advanced $2,999+ / $600. Store cents and immutable deal snapshots. An increased Advanced sale price does not automatically increase commission.

Do not merge or deploy this draft until the validation and provider acceptance checklist is complete.
