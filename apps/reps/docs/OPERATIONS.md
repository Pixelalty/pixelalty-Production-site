# Operating Pixelalty Sales

## Environment boundaries

Keep staging Supabase, Stripe sandbox keys/webhooks, Turnstile and the staging Worker together. Production uses its own bindings. A wrong Stripe mode or webhook signature is rejected. Do not copy live customer records into fixtures.

Apply the five files in `supabase/migrations` in timestamp order to the explicitly selected staging project. The migrations create `public.px_*` objects and `px_private`; they do not modify the existing website's tables. Review conflicts before applying to a database that already contains these objects. Track them as migrations, not untracked SQL editor edits. Do not alter an applied migration later; add a new one.

These migrations have only been tested in isolated PGlite so far. Verify Supabase PostgREST schema exposure, function grants and Auth claims in staging before production. Never expose `px_private` through the Data API.

## Owner setup and launch configuration

Use `scripts/bootstrap-owner.sql` with the intended confirmed Auth user UUID. Run its setting and block together in one SQL editor submission/session. Owner is a database role; editing user metadata never grants it. MFA is required on every administrative session. No bootstrap owner or production agreement is seeded.

Before activating a rep, publish the current required agreement; review training, classification, tax verification and payout setup; confirm the rep's email; then use Activate with an audit reason. Contractor payouts use Connect. Employee payroll stays external. Store verification status here, not tax identifiers, tax forms or bank account numbers.

Review calling hours and relevant business requirements before enabling calling in Settings. DNC suppression applies across reps, assignments and imports. The app offers manual `tel:` links; it does not provide a dialer, recording or automated messaging.

## Payment states

1. A deal snapshots an approved package and the assigned rep. Checkout is created on the server.
2. Signed webhook processing retrieves fresh Stripe state and verifies session/deal/rep/package/amount/currency attribution.
3. A verified payment creates one earned commission and one fulfillment handoff. Selecting Sale Reported creates neither.
4. The commission stays on hold until both the configured hold period and settlement conditions pass. Refunds, disputes and manual holds prevent release.
5. Finance authorizes an eligible transfer with MFA and a reason. The transfer request is persisted before contacting Stripe.
6. A completed Connect transfer and a connected account's bank payout are distinct records. Never describe transfer success as bank payment confirmation.

Default customer price / commission pairs are $799/$125, $1,299/$250, $1,999/$400, and $2,999+/$600. Package edits create prospective versions. Historical deals remain unchanged.

## Interrupted provider operations

Use **Finance → Reconcile provider result** when Stripe completed an operation but its response could not be saved. Select checkout, transfer or reversal; provide the corresponding local deal/request UUID, provider object ID and a reason. The server retrieves the provider object and checks attribution before recording it.

Checkout and reversal attempts older than 23 hours stop retrying automatically when unresolved. Transfer requests likewise require reconciliation after their safe retry window. Never create a fresh operation merely to get around an uncertain prior attempt. Search the sandbox or live account matching the Worker environment and inspect metadata to locate the original object.

Reversal requests persist the amount and reason, reserve the remaining reversible balance and reuse the same request identifier. Refund/dispute events after a transfer create recovery review. They do not silently delete earned history or automatically debit a rep. Partial refunds remain a finance decision.

A result verified through this UI must already exist in Stripe. Resolving an expired attempt with conclusively no provider object requires a separately reviewed repair; the UI intentionally has no blind reset. Record evidence and an audit reason for any repair.

## Imports and background work

CSV, TSV and XLSX imports require a name, valid phone and verified IANA timezone. Normalize, inspect errors, then commit. Formula cells are rejected as rows and CSV exports escape formula-looking values. Older XLS files must be converted to XLSX. The first worksheet is used.

Committed import chunks can be retried. A network interruption while staging may leave an incomplete batch; inspect its staged row count before creating a replacement. Archiving a batch only archives untouched imported leads. Calls, deals and financial history are retained.

The cron runs every 15 minutes. Check System Health for the last completed tick, failed Stripe events and pending jobs. Stripe retries failed webhook deliveries; after correcting the cause, replay the original event in Stripe and verify its final status. The scheduled payment pass is bounded and does not replace monitoring.

Payment processing isolates optional XP/notification failures and records `sale_progression` jobs. Automated processing of those failed jobs is not implemented yet. An operator must reconcile them with idempotent XP inserts and retain the job/audit evidence. This is a documented release follow-up, not a claim that the queue is self-healing.

## Release and rollback

Complete `QA.md` in staging before enabling production DNS, live keys or real transfers. Back up the selected production database and record the exact migration/Worker revisions before release. Keep the public site's existing Auth settings and records intact.

Cloudflare can roll back the Worker version. Database/financial history must not be rolled back by deleting ledger rows or replaying destructive migrations. If a release fails after writes occur, disable the affected operation, reconcile provider state and apply a forward repair with an audit trail.
