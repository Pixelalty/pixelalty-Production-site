import { useState } from "react";
import { ShieldCheck, Activity } from "lucide-react";
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
  type Field,
} from "./lib";
import { label, money, type Row } from "../shared/core";
import { ContentAdmin } from "./content-admin";
import { Pipeline } from "./pipeline";
import { Imports } from "./imports";
import { BusinessDetails, RepDetails } from "./details";
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
    [repDetail, setRepDetail] = useState<Row | null>(null),
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
      {repDetail && (
        <RepDetails rep={repDetail} onClose={() => setRepDetail(null)} />
      )}
    </>
  );
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
                onClick={() =>
                  show(
                    "Verify classification",
                    "rep_classification",
                    { id: r.id },
                    [
                      {
                        name: "classification",
                        label: "Worker classification",
                        required: true,
                        options: choices(["contractor", "employee"]),
                      },
                      {
                        name: "tax_status",
                        label: "Tax verification status",
                        required: true,
                        options: choices(["pending", "verified"]),
                      },
                      {
                        name: "external_payout_verified",
                        label:
                          "Approved external payroll/payment setup verified",
                        type: "checkbox",
                      },
                    ],
                  )
                }
              >
                Requirements
              </button>
              <button onClick={() => setRepDetail(r)}>View readiness</button>
              <button onClick={() => show("Activate rep", "rep_activate", r)}>
                Activate
              </button>
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
  const state = useData("/report?kind=admin");
  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="The business, at a glance."
        description="A clear starting point for running Pixelalty Sales."
      />
      <State {...state}>
        <div className="stats">
          {Object.entries(state.data || {}).map(([k, v]) => (
            <Card key={k}>
              <div className="stat-label">{label(k)}</div>
              <div className="stat-value">
                {k.endsWith("_cents") ? money(Number(v)) : String(v)}
              </div>
            </Card>
          ))}
        </div>
      </State>
      <Card title="Operating order">
        <ol className="operating-order">
          <li>Review applications and invite approved reps.</li>
          <li>Verify onboarding and activate eligible accounts.</li>
          <li>Import businesses, review exceptions, and assign leads.</li>
          <li>Monitor verified payments and commission holds.</li>
          <li>Authorize eligible transfers and track bank payouts.</li>
        </ol>
      </Card>
    </>
  );
}
function Settings() {
  const app = useApp();
  return (
    <>
      <Heading
        title="Workspace settings"
        description="Configuration changes are audited. Calling must be explicitly enabled after review."
      />
      <div className="onboarding-grid">
        <Card title="Workflow policy">
          <Form
            initial={app.ctx.settings}
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
                name: "recruiting_open",
                label: "Accept applications",
                type: "checkbox",
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
        <SettingsGroup
          title="Recruiting page"
          fields={[
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
        <SettingsGroup
          title="Activation requirements"
          fields={[
            ["require_profile", "Completed profile"],
            ["require_agreement", "Accepted current agreement"],
            ["require_tax", "Verified tax status"],
            ["require_payout", "Verified payout setup"],
          ].map(([name, label]) => ({ name, label, type: "checkbox" }))}
        />
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
      </div>
    </>
  );
}
function SettingsGroup({ title, fields }: { title: string; fields: Field[] }) {
  const app = useApp();
  return (
    <Card title={title}>
      <Form
        initial={app.ctx.settings}
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
          {Object.entries(state.data || {}).map(([k, v]) => (
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
