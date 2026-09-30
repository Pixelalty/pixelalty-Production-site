# V1 acceptance ledger

Source: the owner's Pixelalty Sales master build instruction, sections 0–256.
Section 172 defines V1. Sections 173–175 explicitly schedule later releases.
The staging-only instruction remains in force. Production is not a test target.

Every row requires implementation, database/API integration, a successful user
flow, failure/authorization coverage, persistence checks and responsive review.
An unchecked hosted gate is not a claim of completion.

| V1 requirement                                                                                 | Relevant master sections                     | Acceptance evidence required                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Password login, invitation acceptance, recovery, email verification and admin MFA              | 6–8, 13, 146, 164                            | Auth success/failure, recovery password completion, role and MFA deny tests               |
| Public recruiting benefits, private commission amounts and accessible application                            | 9–13, 221–223                                | Public form, duplicate/spam rejection, persistent application, confirmation               |
| Applicant review, stages, notes, filters, approval and immutable rep IDs                       | 11–14                                        | Recruiting workflow and safe invitation retries                                           |
| Onboarding checklist, profile, versioned agreement, classification and payout gates            | 15–18                                        | Per-step state, failed gates, completed activation, preserved signatures                  |
| Training lessons, quizzes, progress and controlled content versions                            | 102–105                                      | Completion, grading, retake, hidden keys, no-code quiz publication                        |
| CSV/XLSX/pasted lead import, mapping, preview, duplicate/DNC checks, reports and safe archival | 28–37, 154–157, 198                          | 5,000+ rows, formula handling, chunk retry/resume, counts, no duplicate records           |
| Authorized prospect search, filters, sorting, pagination and saved views                       | 44–45, 179, 202                              | More than one page, filter persistence, role-aware detail view                            |
| Transactional claims, capacity, assignment history and expiration                              | 40–43, 229–232                               | Concurrent claims, no overcapacity, expiry and reassignment                               |
| Prospect queue, manual call dispositions, scripts, notes and favorites                         | 45–53, 137–138                               | Actual queue flow, idempotent saves, suppression, keyboard use                            |
| Follow-up scheduling, rescheduling, completion and reminders                                   | 55, 97, 225–226                              | Timezone handling, due/overdue states and scheduled delivery                              |
| Pipeline table/board, attributed deals, Advanced quotes and snapshots                          | 56–61, 183–186, 236–237                      | Immutable price/commission, permitted stage transitions, administrator quote approval     |
| Stripe Checkout, signed events, payment attribution and fulfillment handoff                    | 19–24, 59–62, 153, 165                       | Sandbox payments, duplicates, ordering, failure, refund/dispute and one handoff           |
| Exact default commissions and finance audit trail                                              | 3, 21–27, 144, 152, 243–247, 255             | $799/$125, $1,299/$250, $1,999/$400, $2,999+/$600; prospective versions                   |
| Connect onboarding, eligibility, transfers, reversals and separate bank payout state           | 18, 20–26, 239–242                           | Sandbox onboarding, holds, interrupted provider calls and reconciliation                  |
| Rep money view with identifiable deals and status totals                                       | 25, 217                                      | Own data only, held/payable/transferred/bank-paid amounts kept distinct                   |
| Rep dashboard, personal goals, XP ledger, levels and profile frames                            | 63–71, 151, 214–216                          | Derived metrics, configurable thresholds, idempotent awards and accessible progress       |
| Optional workday streak based on qualifying calls, weekends and freezes                        | 74–75, 194                                   | Prospect deduplication, rep timezone, protected weekends and freeze accounting            |
| Leaderboards without personal earnings or customer data                                        | 83–84, 218                                   | Verified sales, authorized metrics, pagination/nearby ranking and minimum samples         |
| Admin command center, rep management, configuration and audit                                  | 109–112, 123, 191–195                        | Role-specific controls, reasoned mutations, onboarding readiness and meaningful totals    |
| DNC, safety defaults and restricted data                                                       | 7–8, 50–51, 122–123, 146–147, 187–190        | RLS/grants, global suppression, no client secrets, private signed-PDF tax upload, no extracted TIN/SSN or bank fields             |
| Basic notifications and operational recovery                                                   | 97, 140–141, 148–149, 167–169, 204–205       | Read state, useful links, retryable jobs, service readiness distinguished from validation |
| Mobile/tablet/desktop, light/dark/system, loading/empty/error states and accessibility         | 4–5, 133, 159–160, 176–182, 199–200, 212–213 | Browser walkthroughs, keyboard/focus, contrast, no page overflow, console/network checks  |
| Source control, staging deployment, operations guide and final audit                           | 0–2, 161–170, 196–207, 250–256               | Clean checks, reviewed migration, staging evidence, no production changes                 |

## Explicit later-release scope

Section 173 defers richer achievements/unlocks, monthly seasons/championships,
messaging, Ask the Closers, mentorship, ideas, recruiting/cohort analytics,
the appearance editor and generalized feature flags. Existing support functionality
is preserved. Section 174 defers integrated calling, advanced scripts/AI/routing,
Power Hours, teams and advanced fulfillment analytics. Section 175 defers predictive
routing, experiments, advanced retention, PWA/push and external lead providers.
These are not visible placeholder features in V1.

The owner's subsequent request for usable customization brings personal workspace
appearance into this revision: themes, fixed accent colors, sidebar style, density,
text size, reduced motion and ordered pinned pages. It applies to all authorized
accounts, including administrators without a rep profile. It is not the generalized
later-release page/layout editor.

## External acceptance gates

- [ ] User-controlled invitation/reset delivery with configured SMTP.
- [ ] Stripe sandbox Checkout, Connect, transfers, refunds/disputes and payouts.
- [ ] Hosted Turnstile submission and staging browser walkthrough.
- [ ] Cloudflare authorized deployment/log inspection.
- [ ] Owner-provided approved agreement and business onboarding policy.
- [ ] Final V1 audit after all gates above.

No hosted gate may be checked using a simulated provider result.

## Current evidence

`npm run check`: 52 passing tests, clean lint/type checks and a successful production build. `npm run test:e2e`: SQL-backed browser flows pass with no unexpected console/API errors at 390/768/1440 px, including visual review of light/dark, owner configuration and onboarding screens. Workspace preference tests exercise intentional Auth save failure, retry, account restoration and safe metadata; navigation tests include owner, rep, onboarding and specialist roles. The actual Worker and SQL functions are exercised; external provider boundaries are simulated. The original five migrations plus the additive V1 completion/index migrations are recorded on staging. The original migration files and production are untouched.

Six additional contention scenarios pass in GitHub CI against twelve simultaneous connections to full PostgreSQL 17. A lock barrier verifies actual overlap for claims, calls, payment deduplication, transfer requests and reversal reservations.

See `QA.md` for the exact scope of these checks. Hosted gates above remain open; this ledger does not certify the entire release as accepted.

### Additive staging migration mapping

| File                                     | Recorded staging version |
| ---------------------------------------- | ------------------------ |
| `20260923235516_sales_v1_completion.sql` | `20260924005536`         |
| `20260924005803_sales_v1_indexes.sql`    | `20260924010027`         |
| `20260924051744_sales_branded_auth_mail.sql` | `20260924054601` |

The index migration passed a fresh application of the complete schema and all 16 focused V1 tests. The performance advisor now reports only unused indexes, which are retained for the intended workloads. Do not reapply the original files using unreconciled CLI timestamps.

## September 24 corrective requirements

The owner’s critical completion pass supersedes the earlier public commission section. Follow [CORRECTIVE_ACCEPTANCE.md](CORRECTIVE_ACCEPTANCE.md) for the actionable onboarding, private W-9, readiness/activation, canonical domain, recruiting privacy, customer-site section and admin-only test indicator requirements. The original acceptance ledger remains in effect for all other V1 flows.
