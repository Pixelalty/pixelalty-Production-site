import { useState } from "react";
import {
  ShieldCheck,
  Activity,
  ArrowRight,
  Users,
  Upload,
  Wallet,
  Palette,
  Settings as SettingsIcon,
  CheckCircle2,
  Circle,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import {
  download,
  useApp,
  useData,
  Heading,
  Card,
  Listing,
  State,
  Modal,
  Form,
  ActionDialog,
  LinkButton,
  type Field,
} from "./lib";
import { label, money, type Row } from "../shared/core";
import { ContentAdmin } from "./content-admin";
import { Pipeline } from "./pipeline";
import { Imports } from "./imports";
import { BusinessDetails } from "./details";
import { OperationsQueue, RepOnboardingDetail, TaxReview } from "./onboarding";
const choices = (values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
type Dialog = {
  title: string;
  action: string;
  initial: Row;
  fields?: Field[];
  endpoint?: string;
};
export function Admin() {
  const app = useApp(),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [businessId, setBusinessId] = useState<string | null>(null),
    page = app.path.split("?")[0];
  const show = (
    title: string,
    action: string,
    initial: Row = {},
    fields: Field[] = [],
    endpoint?: string,
  ) => setDialog({ title, action, initial, fields, endpoint });
  const view = (
    <>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
      {businessId && (
        <BusinessDetails id={businessId} onClose={() => setBusinessId(null)} />
      )}
    </>
  );
  const repCode = new URLSearchParams(app.path.split("?")[1]).get("rep_code");
  if (page === "/admin/tax") return <TaxReview />;
  if (page === "/admin/reps" && repCode)
    return <RepOnboardingDetail code={repCode} />;
  if (page === "/admin/pipeline") return <Pipeline admin />;
  if (page === "/admin/imports") return <Imports />;
  if (page === "/admin/settings") return <Settings />;
  if (page === "/admin/content") return <ContentAdmin />;
  if (page === "/admin/health") return <Health />;
  if (page === "/admin/recruiting")
    return (
      <>
        <Heading
          eyebrow="ADMINISTRATION"
          title="Recruiting"
          description="Review each applicant, record a decision, and send an invitation."
        />
        <Listing
          name="applicants"
          columns={[
            ["code", "Applicant"],
            ["name", "Name"],
            ["email", "Email"],
            ["stage", "Stage"],
            ["created_at", "Applied"],
          ]}
          actions={(r) => (
            <>
              <button onClick={() => setDetail(r)}>Review</button>
              <button
                onClick={() =>
                  show("Change stage", "applicant_stage", r, [
                    {
                      name: "stage",
                      label: "Stage",
                      required: true,
                      options: choices([
                        "new",
                        "review",
                        "interview",
                        "interview_scheduled",
                        "offer",
                        "withdrawn",
                        "inactive",
                        "rejected",
                      ]),
                    },
                  ])
                }
              >
                Stage
              </button>
              {r.rep_id && (
                <button
                  onClick={() =>
                    app.navigate("/admin/reps?rep_code=" + r.rep_code)
                  }
                >
                  Rep created — Manage onboarding
                </button>
              )}
              {!r.rep_id && (
                <button
                  onClick={() =>
                    show("Approve & invite", "", r, [], "/approve")
                  }
                >
                  Approve & invite
                </button>
              )}
            </>
          )}
        />
        {detail && (
          <Modal title={detail.name} onClose={() => setDetail(null)}>
            <div className="detail-grid">
              {Object.entries(detail.details).map(([k, v]) => (
                <div key={k}>
                  <small>{label(k)}</small>
                  <p>{String(v)}</p>
                </div>
              ))}
            </div>
            <Form
              fields={[
                {
                  name: "body",
                  label: "Internal review note",
                  type: "textarea",
                  required: true,
                },
              ]}
              submit="Add note"
              onSubmit={async (p) => {
                await app.mutate("applicant_note", {
                  id: detail.id,
                  ...p,
                  reason: "Applicant review note",
                });
              }}
            />
            <Listing
              name="applicant_notes"
              query={"&applicant=" + detail.id}
              columns={[
                ["body", "Review note"],
                ["created_at", "Added"],
              ]}
            />
          </Modal>
        )}
        {view}
      </>
    );
  if (page === "/admin/reps")
    return (
      <>
        <Heading
          eyebrow="ADMINISTRATION"
          title="Rep management"
          description="Verify requirements before activation. Financial history remains available after suspension."
        />
        <OperationsQueue />
        <Listing
          name="reps"
          columns={[
            ["code", "Rep"],
            ["name", "Name"],
            ["status", "Status"],
            ["timezone", "Timezone"],
            ["capacity", "Capacity"],
          ]}
          actions={(r) => (
            <>
              <button
                onClick={() => app.navigate("/admin/reps?rep_code=" + r.code)}
              >
                Manage onboarding & readiness
              </button>
              {["onboarding", "active"].includes(r.status) &&
                app.has("sales_admin") && (
                  <button
                    onClick={() =>
                      show(
                        "Send account setup email",
                        "resend_begin",
                        { id: r.id },
                        [],
                        "/invite/resend",
                      )
                    }
                  >
                    Send setup email
                  </button>
                )}
              {r.status === "onboarding" && (
                <button
                  onClick={() => app.navigate("/admin/reps?rep_code=" + r.code)}
                >
                  Review activation requirements
                </button>
              )}
              <button onClick={() => show("Suspend rep", "rep_suspend", r)}>
                Suspend
              </button>
              {r.status !== "offboarded" && (
                <button onClick={() => show("Offboard rep", "rep_offboard", r)}>
                  Offboard
                </button>
              )}
              {app.has("owner") && (
                <button
                  onClick={() =>
                    show("Update capacity", "rep_capacity", r, [
                      {
                        name: "capacity",
                        label: "Maximum active leads",
                        type: "number",
                        min: 1,
                        max: 100,
                        required: true,
                      },
                    ])
                  }
                >
                  Capacity
                </button>
              )}
            </>
          )}
        />
        {app.has("owner") && (
          <Card title="Role management">
            <p>
              Administrative roles require MFA. Give each person the permissions
              they need.
            </p>
            <button
              onClick={() =>
                show("Update role", "role", {}, [
                  {
                    name: "id",
                    label: "Rep account",
                    required: true,
                    searchTable: "reps",
                  },
                  {
                    name: "role",
                    label: "Role",
                    required: true,
                    options: choices([
                      "owner",
                      "sales_admin",
                      "manager",
                      "finance_admin",
                      "compliance_admin",
                      "content_admin",
                      "support",
                    ]),
                  },
                  {
                    name: "enabled",
                    label: "Grant role (uncheck to remove)",
                    type: "checkbox",
                  },
                ])
              }
            >
              Manage a role
            </button>
          </Card>
        )}
        {view}
      </>
    );
  if (page === "/admin/leads")
    return (
      <>
        <Heading
          eyebrow="ADMINISTRATION"
          title="Business database"
          description="Review ownership, contact restrictions, and lead assignment."
        >
          <button
            onClick={() =>
              app.run(() =>
                download("/export/businesses", "pixelalty-businesses.csv"),
              )
            }
          >
            Export businesses
          </button>
        </Heading>
        <Listing
          name="businesses"
          columns={[
            ["code", "Business ID"],
            ["name", "Business"],
            ["phone", "Phone"],
            ["stage", "Stage"],
            ["source", "Source"],
          ]}
          actions={(r) => (
            <>
              <button onClick={() => setBusinessId(r.id)}>Details</button>
              <button
                onClick={() =>
                  show("Assign business", "assign", r, [
                    {
                      name: "rep_id",
                      label: "Active rep",
                      required: true,
                      searchTable: "reps",
                      searchQuery: "&status=active",
                    },
                  ])
                }
              >
                Assign
              </button>
              {r.owner_id && !r.customer && (
                <button
                  onClick={() => show("Release business", "lead_release", r)}
                >
                  Release
                </button>
              )}
            </>
          )}
        />
        {view}
      </>
    );
  if (page === "/admin/finance")
    return (
      <>
        <Heading
          eyebrow="FINANCE"
          title="Commissions & payouts"
          description="Review payment health, release holds, and authorize eligible transfers."
        />
        <div className="notice">
          A Connect transfer moves funds to a connected account. The bank payout
          is a separate event. An uncertain transfer requires reconciliation
          before retrying.
        </div>
        <Listing
          name="commissions"
          columns={[
            ["amount_cents", "Commission"],
            ["status", "Status"],
            ["hold_until", "Hold until"],
            ["reversed_cents", "Reversed"],
            ["rep_name", "Rep"],
          ]}
          actions={(r) => (
            <>
              <button onClick={() => show("Place hold", "commission_hold", r)}>
                Hold
              </button>
              <button
                onClick={() =>
                  show("Release manual hold", "commission_release", r)
                }
              >
                Release hold
              </button>
              {!r.transfer_id && (
                <button
                  onClick={() =>
                    show("Authorize transfer", "", r, [], "/transfer")
                  }
                >
                  Transfer
                </button>
              )}
              {r.transfer_id && (
                <button
                  onClick={() =>
                    show(
                      "Reverse transfer",
                      "",
                      { ...r, request_id: crypto.randomUUID() },
                      [
                        {
                          name: "amount_cents",
                          label: "Amount to reverse (cents)",
                          type: "number",
                          min: 1,
                          max: r.amount_cents - r.reversed_cents,
                          required: true,
                        },
                      ],
                      "/reverse",
                    )
                  }
                >
                  Reverse
                </button>
              )}
            </>
          )}
        />
        <h2>Package versions</h2>
        <button
          onClick={() =>
            show("Create package", "package_create", {}, [
              {
                name: "code",
                label: "Package reference",
                required: true,
                hint: "Lowercase words separated by hyphens.",
              },
              { name: "name", label: "Package name", required: true },
              {
                name: "description",
                label: "Public description",
                type: "textarea",
              },
              {
                name: "price_cents",
                label: "Customer price ($)",
                type: "currency",
                required: true,
              },
              {
                name: "commission_cents",
                label: "Commission ($)",
                type: "currency",
                required: true,
              },
              {
                name: "sale_xp",
                label: "Verified sale XP",
                type: "number",
                required: true,
                min: 0,
                max: 10000,
              },
            ])
          }
        >
          Create package
        </button>
        <Listing
          name="packages"
          columns={[
            ["name", "Package"],
            ["version", "Version"],
            ["price_cents", "Sale"],
            ["commission_cents", "Commission"],
          ]}
          actions={(r) =>
            r.active && (
              <>
                <button
                  onClick={() =>
                    show("Publish prospective pricing", "package", r, [
                      { name: "name", label: "Package name", required: true },
                      {
                        name: "description",
                        label: "Public description",
                        type: "textarea",
                      },
                      {
                        name: "sale_xp",
                        label: "Verified sale XP",
                        type: "number",
                        required: true,
                        min: 0,
                        max: 10000,
                      },
                      {
                        name: "price_cents",
                        label: "Customer price ($)",
                        type: "currency",
                        required: true,
                      },
                      {
                        name: "commission_cents",
                        label: "Rep commission ($)",
                        type: "currency",
                        required: true,
                      },
                    ])
                  }
                >
                  New version
                </button>
                <button
                  onClick={() => show("Archive package", "package_archive", r)}
                >
                  Archive
                </button>
              </>
            )
          }
        />
        <h2>Customer payments</h2>
        <Listing
          name="payments"
          columns={[
            ["amount_cents", "Paid"],
            ["refunded_cents", "Refunded"],
            ["disputed", "Disputed"],
            ["settled", "Settled"],
            ["payment_intent", "Payment intent"],
          ]}
        />
        <h2>Bank payouts</h2>
        <Listing
          name="payouts"
          columns={[
            ["rep_name", "Rep"],
            ["amount_cents", "Amount"],
            ["status", "Status"],
            ["arrival_at", "Estimated arrival"],
          ]}
        />
        <h2>Stripe event health</h2>
        <Card title="Reconcile an interrupted provider operation">
          <p>
            Look up the original Stripe object and match it to the deal or
            request below. This verifies an existing operation; it does not
            create a new charge or transfer.
          </p>
          <button
            onClick={() =>
              show(
                "Reconcile Stripe operation",
                "",
                {},
                [
                  {
                    name: "kind",
                    label: "Operation",
                    required: true,
                    options: choices([
                      "checkout",
                      "connect",
                      "transfer",
                      "reversal",
                    ]),
                  },
                  {
                    name: "id",
                    label:
                      "Deal ID for checkout, rep ID for Connect, or transfer/reversal request ID",
                    required: true,
                  },
                  {
                    name: "object_id",
                    label: "Stripe Checkout, Account, Transfer, or Reversal ID",
                    required: true,
                  },
                ],
                "/reconcile",
              )
            }
          >
            Reconcile operation
          </button>
        </Card>
        <h2>Connect setup attempts</h2>
        <Listing
          name="connect_requests"
          columns={[
            ["rep_id", "Rep ID"],
            ["started_at", "Started"],
            ["account_id", "Connected account"],
          ]}
        />
        <h2>Transfer requests</h2>
        <Listing
          name="transfer_requests"
          columns={[
            ["id", "Request ID"],
            ["commission_id", "Commission"],
            ["status", "Status"],
            ["transfer_id", "Stripe transfer"],
            ["created_at", "Requested"],
          ]}
        />
        <h2>Reversal requests</h2>
        <Listing
          name="reversal_requests"
          columns={[
            ["id", "Request ID"],
            ["commission_id", "Commission"],
            ["amount_cents", "Amount"],
            ["status", "Status"],
            ["reversal_id", "Stripe reversal"],
          ]}
        />
        <Listing
          name="stripe_events"
          columns={[
            ["type", "Event"],
            ["status", "Status"],
            ["error", "Review needed"],
            ["created_at", "Received"],
          ]}
        />
        {view}
      </>
    );
  if (page === "/admin/compliance")
    return (
      <>
        <Heading
          eyebrow="COMPLIANCE"
          title="Do not contact"
          description="Suppression applies across assignments and imports."
        >
          <button
            className="primary"
            onClick={() =>
              show("Add to DNC", "dnc_add", {}, [
                {
                  name: "phone",
                  label: "Phone with country code, e.g. +12125550100",
                  required: true,
                },
              ])
            }
          >
            Add number
          </button>
        </Heading>
        <Listing
          name="dnc"
          columns={[
            ["phone", "Phone"],
            ["reason", "Reason"],
            ["active", "Suppressed"],
            ["created_at", "Added"],
          ]}
          actions={(r) =>
            r.active && (
              <button
                onClick={() => show("Remove DNC restriction", "dnc_remove", r)}
              >
                Remove with reason
              </button>
            )
          }
        />
        {view}
      </>
    );
  if (page === "/admin/support")
    return (
      <>
        <Heading title="Support inbox" />
        <Listing
          name="support"
          columns={[
            ["subject", "Subject"],
            ["body", "Message"],
            ["status", "Status"],
            ["rep_name", "Rep"],
          ]}
          actions={(r) => (
            <button
              onClick={() =>
                show("Reply to ticket", "support_reply", r, [
                  {
                    name: "reply",
                    label: "Response",
                    type: "textarea",
                    required: true,
                  },
                  {
                    name: "status",
                    label: "Status",
                    required: true,
                    options: choices(["open", "pending", "resolved"]),
                  },
                ])
              }
            >
              Respond
            </button>
          )}
        />
        {view}
      </>
    );
  if (page === "/admin/fulfillment")
    return (
      <>
        <Heading
          title="Fulfillment handoff"
          description="Verified customer payments create one handoff per deal."
        />
        <Listing
          name="fulfillment"
          columns={[
            ["deal_id", "Deal"],
            ["status", "Status"],
            ["notes", "Notes"],
            ["created_at", "Created"],
          ]}
          actions={(r) => (
            <button
              onClick={() =>
                show("Update handoff", "fulfillment", r, [
                  {
                    name: "status",
                    label: "Status",
                    options: choices([
                      "new",
                      "contacted",
                      "in_progress",
                      "complete",
                    ]),
                    required: true,
                  },
                  { name: "notes", label: "Handoff notes", type: "textarea" },
                ])
              }
            >
              Update
            </button>
          )}
        />
        {view}
      </>
    );
  if (page === "/admin/audit")
    return (
      <>
        <Heading
          title="Audit log"
          description="An append-only history of sensitive changes."
        />
        <Listing
          name="audit"
          columns={[
            ["created_at", "Time"],
            ["action", "Action"],
            ["actor_id", "Actor"],
            ["target_id", "Target"],
            ["reason", "Reason"],
          ]}
        />
      </>
    );
  return <AdminHome />;
}
function AdminHome() {
  const app = useApp(),
    state = useData("/report?kind=admin"),
    d = state.data || {};
  const accessible = (to: string) =>
    app.pages.some((p: { to: string }) => p.to === to);
  const destinations = [
    {
      to: "/admin/recruiting",
      title: "Build your sales team",
      body: "Review applications, invite reps and follow their onboarding.",
      icon: Users,
      action: "Open recruiting",
    },
    {
      to: "/admin/imports",
      title: "Add your next prospects",
      body: "Import a spreadsheet, review duplicates and prepare leads for your team.",
      icon: Upload,
      action: "Import leads",
    },
    {
      to: "/admin/finance",
      title: "Manage commissions",
      body: "Review earned commission, holds, transfers and payout records.",
      icon: Wallet,
      action: "Open finance",
    },
  ].filter((p) => accessible(p.to));
  return (
    <>
      <Heading
        eyebrow="PIXELALTY SALES"
        title="The business, at a glance."
        description="Your team, your pipeline, and a clear next step."
      >
        <LinkButton to="/appearance">
          <Palette size={16} /> Customize workspace
        </LinkButton>
        <LinkButton to="/admin/imports" primary>
          <Upload size={16} /> Import leads
        </LinkButton>
      </Heading>
      <OperationsQueue compact />
      <State {...state}>
        <div className="stats overview-stats">
          {[
            ["Active reps", d.active_reps || 0, "Ready to work", "/admin/reps"],
            [
              "Available leads",
              d.available_leads || 0,
              "Ready to assign",
              "/admin/leads",
            ],
            [
              "Verified sales",
              d.paid_deals || 0,
              "Payment confirmed",
              "/admin/pipeline",
            ],
            [
              "Net payment revenue",
              money(d.revenue_cents || 0),
              "Recorded payments less refunds",
              "/admin/pipeline",
            ],
          ].map(([title, value, caption, to]) => (
            <Card key={String(title)}>
              <div className="stat-label">{title}</div>
              <div className="stat-value">{value}</div>
              <div className="stat-bottom">
                <span>{caption}</span>
                <LinkButton to={String(to)}>
                  <ArrowRight size={16} />
                  <span className="sr-only">View {title}</span>
                </LinkButton>
              </div>
            </Card>
          ))}
        </div>
        <section className="work-queue" aria-labelledby="work-queue-title">
          <div>
            <span className="eyebrow">YOUR WORK QUEUE</span>
            <h2 id="work-queue-title">Keep things moving</h2>
          </div>
          <div className="queue-links">
            {[
              [d.applicants || 0, "New applications", "/admin/recruiting"],
              [d.onboarding_reps || 0, "Reps onboarding", "/admin/reps"],
              [d.pending_quotes || 0, "Quotes to review", "/admin/pipeline"],
            ].map(([count, title, to]) => (
              <LinkButton to={String(to)} key={String(title)}>
                <strong>{count}</strong>
                <span>{title}</span>
                <ArrowRight size={17} />
              </LinkButton>
            ))}
          </div>
        </section>
      </State>
      <div className="launch-grid">
        {destinations.map(({ to, title, body, icon: Icon, action }) => (
          <Card key={to}>
            <span className="launch-icon">
              <Icon size={22} />
            </span>
            <h2>{title}</h2>
            <p>{body}</p>
            <LinkButton to={to}>
              {action}
              <ArrowRight size={16} />
            </LinkButton>
          </Card>
        ))}
      </div>
      <div className="owner-home-grid">
        <Card
          title="Make Pixelalty work your way"
          extra={<SettingsIcon size={19} />}
        >
          <div className="configuration-links">
            {[
              {
                to: "/appearance",
                title: "Customize your workspace",
                detail: "Theme, accent color, spacing and pinned pages",
                icon: Palette,
              },
              {
                to: "/admin/settings",
                title: "Set your operating rules",
                detail:
                  "Lead ownership, calling windows and onboarding requirements",
                icon: SettingsIcon,
              },
              {
                to: "/admin/content",
                title: "Publish training & agreements",
                detail: "Lessons, quizzes, scripts and versioned documents",
                icon: BookOpen,
              },
              {
                to: "/admin/finance",
                title: "Configure packages & commissions",
                detail:
                  "Create prospective versions without changing past deals",
                icon: Wallet,
              },
            ]
              .filter((p) => accessible(p.to))
              .map(({ to, title, detail, icon: Icon }) => (
                <LinkButton to={to} key={to}>
                  <Icon size={19} />
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                  <ArrowRight size={16} />
                </LinkButton>
              ))}
          </div>
        </Card>
        <Card title="Team readiness" extra={<ShieldCheck size={19} />}>
          <State {...state}>
            {[
              {
                done: !!app.ctx.settings.recruiting_open,
                title: "Recruiting applications",
                detail: app.ctx.settings.recruiting_open
                  ? "Your application form is open."
                  : "Applications are currently closed.",
                to: "/admin/settings?section=recruiting",
                permission: "/admin/settings",
              },
              {
                done: d.required_agreements > 0,
                title: "Required agreement",
                detail:
                  d.required_agreements > 0
                    ? "An active agreement is published."
                    : "Publish your approved agreement before activating reps.",
                to: "/admin/content",
                permission: "/admin/content",
              },
              {
                done: !!app.ctx.settings.calling_enabled,
                title: "Manual calling",
                detail: app.ctx.settings.calling_enabled
                  ? "Enabled within your approved calling window."
                  : "Off until you approve the calling policy.",
                to: "/admin/settings",
                permission: "/admin/settings",
              },
            ]
              .filter((p) => accessible(p.permission))
              .map((p) => (
                <div className="readiness-item" key={p.title}>
                  {p.done ? (
                    <CheckCircle2 className="ready" size={20} />
                  ) : (
                    <Circle size={20} />
                  )}
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.detail}</p>
                  </div>
                  <LinkButton to={p.to}>
                    {p.done ? "Manage" : "Set up"}
                  </LinkButton>
                </div>
              ))}
          </State>
          <a className="button" href="/apply" target="_blank" rel="noreferrer">
            View recruiting page <ExternalLink size={15} />
          </a>
        </Card>
      </div>
    </>
  );
}
function Settings() {
  const app = useApp();
  const sections = [
    ["workflow", "Workflow & calling"],
    ["recruiting", "Recruiting page"],
    ["progression", "Progression & training"],
    ["activation", "Rep activation"],
  ];
  const requested = new URLSearchParams(app.path.split("?")[1]).get("section");
  const selected = sections.some(([key]) => key === requested)
    ? requested
    : "workflow";
  return (
    <>
      <Heading
        title="Workspace settings"
        description="Configuration changes are audited. Calling must be explicitly enabled after review."
      />
      <nav className="settings-tabs" aria-label="Settings sections">
        {sections.map(([key, title]) => (
          <button
            key={key}
            className={selected === key ? "selected" : ""}
            aria-current={selected === key ? "page" : undefined}
            onClick={() => app.navigate("/admin/settings?section=" + key)}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className="settings-content" key={selected}>
        {selected === "workflow" && (
          <>
            <Card title="Workflow policy">
              <Form
                initial={Object.fromEntries(
                  [
                    "hold_days",
                    "first_attempt_hours",
                    "ownership_days",
                    "call_start",
                    "call_end",
                    "calling_enabled",
                    "claim_count",
                  ].map((key) => [key, app.ctx.settings[key]]),
                )}
                fields={[
                  {
                    name: "hold_days",
                    label: "Commission hold (days)",
                    type: "number",
                    min: 0,
                    max: 90,
                    required: true,
                  },
                  {
                    name: "first_attempt_hours",
                    label: "First attempt deadline (hours)",
                    type: "number",
                    min: 1,
                    max: 720,
                    required: true,
                  },
                  {
                    name: "ownership_days",
                    label: "Lead ownership (days)",
                    type: "number",
                    min: 1,
                    max: 90,
                    required: true,
                  },
                  {
                    name: "call_start",
                    label: "Calling window starts (local hour)",
                    type: "number",
                    min: 0,
                    max: 23,
                    required: true,
                  },
                  {
                    name: "call_end",
                    label: "Calling window ends (local hour)",
                    type: "number",
                    min: 1,
                    max: 24,
                    required: true,
                  },
                  {
                    name: "calling_enabled",
                    label: "Approved manual calling hours are configured",
                    type: "checkbox",
                  },
                  {
                    name: "claim_count",
                    label: "Leads per claim",
                    type: "number",
                    min: 1,
                    max: 20,
                    required: true,
                  },
                  {
                    name: "reason",
                    label: "Reason for changing policy",
                    type: "textarea",
                    required: true,
                  },
                ]}
                submit="Save policy"
                onSubmit={async (p) => {
                  const { reason, ...value } = p;
                  await app.mutate("settings", { reason, value });
                  app.reloadContext();
                }}
              />
            </Card>
          </>
        )}
        {selected === "recruiting" && (
          <>
            <Card title="Application form">
              <p>
                Your recruiting headline and description appear on the public
                application page.
              </p>
              <a
                className="button"
                href="/apply"
                target="_blank"
                rel="noreferrer"
              >
                Preview recruiting page <ExternalLink size={15} />
              </a>
            </Card>
            <SettingsGroup
              title="Recruiting page"
              fields={[
                {
                  name: "recruiting_open",
                  label: "Accept applications",
                  type: "checkbox",
                },
                {
                  name: "recruiting_title",
                  label: "Headline",
                  required: true,
                  minLength: 5,
                  maxLength: 180,
                },
                {
                  name: "recruiting_body",
                  label: "Opportunity description",
                  type: "textarea",
                  required: true,
                  minLength: 20,
                  maxLength: 3000,
                },
              ]}
            />
          </>
        )}
        {selected === "progression" && (
          <SettingsGroup
            title="Progression & training"
            fields={[
              ...[
                ["xp_per_level", "XP per level", 50, 10000],
                ["xp_attempt", "Call attempt XP", 0, 50],
                ["xp_conversation", "Conversation XP", 0, 100],
                ["xp_interested", "Interested outcome XP", 0, 100],
                ["xp_training", "Lesson XP", 0, 500],
                ["xp_first_call", "First call milestone XP", 0, 100],
                ["xp_followup", "Completed follow-up XP", 0, 50],
                ["raw_xp_cap", "Daily call XP cap", 1, 500],
                ["streak_target", "Optional daily streak target", 1, 500],
                ["streak_freezes", "Monthly streak freezes", 0, 10],
                ["quiz_pass_score", "Quiz passing percentage", 1, 100],
              ].map(([name, label, min, max]) => ({
                name: String(name),
                label: String(label),
                type: "number",
                min: Number(min),
                max: Number(max),
                required: true,
              })),
            ]}
          />
        )}
        {selected === "activation" && (
          <SettingsGroup
            title="Activation requirements"
            fields={[
              ["require_profile", "Completed profile"],
              ["require_agreement", "Accepted current agreement"],
              ["require_tax", "Verified tax status"],
              ["require_payout", "Verified payout setup"],
            ].map(([name, label]) => ({ name, label, type: "checkbox" }))}
          />
        )}
        {selected === "workflow" && (
          <Card title="Feature readiness">
            <ShieldCheck size={32} />
            <h3>V1 keeps contact methods explicit.</h3>
            <p>
              Integrated calling, call recording, AI calling, SMS, automated
              transfers, and cash competitions are disabled.
            </p>
            <p>
              Tax verification, worker classification, approved agreements, and
              payout eligibility remain required.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
function SettingsGroup({ title, fields }: { title: string; fields: Field[] }) {
  const app = useApp();
  return (
    <Card title={title}>
      <Form
        initial={Object.fromEntries(
          fields.map((field) => [field.name, app.ctx.settings[field.name]]),
        )}
        fields={[
          ...fields,
          {
            name: "reason",
            label: "Reason for this change",
            type: "textarea",
            required: true,
            minLength: 5,
          },
        ]}
        submit="Save settings"
        onSubmit={async (p) => {
          const { reason, ...value } = p;
          await app.mutate("settings", { reason, value });
          app.reloadContext();
        }}
      />
    </Card>
  );
}
function Health() {
  const state = useData("/health");
  return (
    <>
      <Heading
        title="System health"
        description="Connection readiness and background work that needs attention."
      />
      <Card title="Configuration">
        <Activity />
        <State {...state}>
          {Object.entries(state.data || {})
            .filter(([k]) => k !== "emailDelivery")
            .map(([k, v]) => (
              <div className="health-row" key={k}>
                <span>{label(k)}</span>
                <strong>
                  {typeof v === "boolean"
                    ? v
                      ? "Configured"
                      : "Off / not configured"
                    : String(v)}
                </strong>
              </div>
            ))}
          {state.data?.emailDelivery && (
            <>
              <div className="health-row">
                <span>Emails waiting</span>
                <strong>{state.data.emailDelivery.pending}</strong>
              </div>
              <div className="health-row">
                <span>Email deliveries to review</span>
                <strong>{state.data.emailDelivery.needs_review}</strong>
              </div>
              <div className="health-row">
                <span>Emails sent</span>
                <strong>{state.data.emailDelivery.sent}</strong>
              </div>
            </>
          )}
        </State>
      </Card>
      <h2>Background jobs</h2>
      <Listing
        name="jobs"
        columns={[
          ["kind", "Job"],
          ["status", "Status"],
          ["error", "Error"],
          ["created_at", "Created"],
        ]}
      />
    </>
  );
}
