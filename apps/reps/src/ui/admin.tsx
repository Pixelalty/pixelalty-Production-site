import { useState } from "react";
import { Upload, ArrowRight, ShieldCheck, Activity } from "lucide-react";
import {
  api,
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
  Table,
  type Field,
} from "./lib";
import { header, label, type Row } from "../shared/core";
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
  const reps = useData("/table?name=reps");
  const app = useApp(),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
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
    </>
  );
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
                        "offer",
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
              <button onClick={() => show("Activate rep", "rep_activate", r)}>
                Activate
              </button>
              <button onClick={() => show("Suspend rep", "rep_suspend", r)}>
                Suspend
              </button>
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
                    options: reps.data?.rows.map((r: Row) => ({
                      value: r.id,
                      label: r.name + " · " + r.code,
                    })),
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
        />
        <Listing
          name="businesses"
          columns={[
            ["code", "Business ID"],
            ["name", "Business"],
            ["phone", "Phone"],
            ["stage", "Stage"],
            ["owner_id", "Assigned rep"],
          ]}
          actions={(r) => (
            <button
              onClick={() =>
                show("Assign business", "assign", r, [
                  {
                    name: "rep_id",
                    label: "Active rep",
                    required: true,
                    options: reps.data?.rows
                      .filter((r: Row) => r.status === "active")
                      .map((r: Row) => ({
                        value: r.id,
                        label: r.name + " · " + r.code,
                      })),
                  },
                ])
              }
            >
              Assign
            </button>
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
            ["rep_id", "Rep"],
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
              <button
                onClick={() =>
                  show("Publish prospective pricing", "package", r, [
                    {
                      name: "price_cents",
                      label: "Sale amount (cents)",
                      type: "number",
                      required: true,
                    },
                    {
                      name: "commission_cents",
                      label: "Commission (cents)",
                      type: "number",
                      required: true,
                    },
                  ])
                }
              >
                New version
              </button>
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
            ["rep_id", "Rep"],
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
                    options: choices(["checkout", "transfer", "reversal"]),
                  },
                  {
                    name: "id",
                    label:
                      "Deal ID for checkout, or request ID for transfer/reversal",
                    required: true,
                  },
                  {
                    name: "object_id",
                    label: "Stripe Checkout, Transfer, or Reversal ID",
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
            ["rep_id", "Rep"],
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
              <div className="stat-value">{String(v)}</div>
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
function Imports() {
  const app = useApp(),
    [file, setFile] = useState<Row | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [defaultZone, setDefaultZone] = useState(""),
    [batch, setBatch] = useState(""),
    [progress, setProgress] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fields = [
    "name",
    "phone",
    "website",
    "email",
    "timezone",
    "city",
    "state",
    "industry",
    "contact",
    "notes",
  ];
  const aliases: Record<string, string[]> = {
    name: ["business", "businessname", "company", "companyname", "name"],
    phone: ["phone", "phonenumber", "telephone"],
    website: ["website", "url", "domain"],
    timezone: ["timezone", "tz"],
    contact: ["contact", "contactname"],
  };
  async function upload(f: File) {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("file", f);
      const data = await api("/import/preview", fd);
      setFile(data);
      const initial: Record<string, string> = {};
      for (const key of fields)
        initial[key] =
          data.headers.find((h: string) =>
            (aliases[key] || [key]).includes(header(h)),
          ) || "";
      setMapping(initial);
      setBatch("");
      setProgress(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit(id: string) {
    setBusy(true);
    setError("");
    try {
      let result;
      do {
        result = await api("/action", {
          action: "import_commit",
          p: { id, reason: "Commit reviewed business import" },
        });
        setProgress(result);
      } while (result.pending > 0);
      app.refresh();
      app.notify("Import completed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Import leads"
        description="Upload, map, review, and import. Duplicates and suppressed numbers stay out."
      >
        <button
          onClick={() =>
            app.run(() =>
              download("/import/template", "pixelalty-import-template.csv"),
            )
          }
        >
          Download template
        </button>
      </Heading>
      <div className="import-steps">
        <span className={file ? "done" : "active"}>1 · Upload</span>
        <ArrowRight />
        <span className={file && !batch ? "active" : ""}>2 · Map & review</span>
        <ArrowRight />
        <span className={batch ? "active" : ""}>3 · Import</span>
      </div>
      <Card>
        <label className="upload-zone">
          <Upload size={32} />
          <strong>Choose a spreadsheet</strong>
          <span>CSV, TSV, or XLSX · up to 8 MB / 25,000 rows</span>
          <input
            type="file"
            accept=".csv,.tsv,.xlsx"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
        {error && <State error={error} />}{" "}
        {busy && (
          <p role="status">Processing your file. Keep this page open…</p>
        )}
        {file && !batch && (
          <>
            <div className="card-head">
              <h2>{file.filename}</h2>
              <span>{file.rows.length.toLocaleString()} rows</span>
            </div>
            <div className="mapping-grid">
              {fields.map((k) => (
                <label className="field" key={k}>
                  <span>
                    {label(k)}
                    {["name", "phone"].includes(k) ? " *" : ""}
                  </span>
                  <select
                    value={mapping[k] || ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [k]: e.target.value })
                    }
                  >
                    <option value="">Not mapped</option>
                    {file.headers.map((h: string) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="field">
              <span>Default timezone for rows without one</span>
              <input
                placeholder="America/New_York"
                value={defaultZone}
                onChange={(e) => setDefaultZone(e.target.value)}
              />
              <small>
                Use a default only after verifying that these businesses share
                that timezone. Unknown timezones are rejected.
              </small>
            </label>
            <Table
              rows={file.rows.slice(0, 5)}
              columns={file.headers.slice(0, 6).map((h: string) => [h, h])}
            />
            <button
              className="primary"
              disabled={busy || !mapping.name || !mapping.phone}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api("/import/prepare", {
                    ...file,
                    mapping,
                    defaultZone,
                  });
                  setBatch(result.id);
                  app.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Validate & stage import <ArrowRight size={16} />
            </button>
          </>
        )}
        {batch && (
          <div className="notice">
            <h3>Import staged for review</h3>
            <p>
              Invalid rows will be rejected. Commit checks global DNC and
              existing phone/domain records again.
            </p>
            <button disabled={busy} onClick={() => commit(batch)}>
              Commit import
            </button>
            <button
              onClick={() =>
                app.run(() =>
                  download(
                    "/import/report?id=" + batch,
                    "pixelalty-import-report.csv",
                  ),
                )
              }
            >
              Validation report
            </button>
            {progress && (
              <p>
                {progress.accepted} accepted · {progress.rejected} rejected ·{" "}
                {progress.pending} remaining
              </p>
            )}
          </div>
        )}
      </Card>
      <h2>Import history</h2>
      <Listing
        name="imports"
        columns={[
          ["filename", "File"],
          ["total", "Rows"],
          ["status", "Status"],
          ["created_at", "Uploaded"],
        ]}
        actions={(r) => (
          <>
            <button
              disabled={busy || r.status !== "ready"}
              onClick={() => {
                setBatch(r.id);
                commit(r.id);
              }}
            >
              Resume import
            </button>
            <button
              onClick={() =>
                app.run(() =>
                  download(
                    "/import/report?id=" + r.id,
                    "pixelalty-import-report.csv",
                  ),
                )
              }
            >
              Report
            </button>
            {r.status === "complete" && (
              <button
                onClick={() =>
                  app.run(() =>
                    app.mutate("import_archive", {
                      id: r.id,
                      reason: "Archive unassigned unused import rows",
                    }),
                  )
                }
              >
                Archive unused
              </button>
            )}
          </>
        )}
      />
    </>
  );
}
function ContentAdmin() {
  const app = useApp(),
    [show, setShow] = useState(false);
  return (
    <>
      <Heading
        title="Training & content"
        description="Publish new versions without changing historic acceptances or quiz attempts."
      >
        <button className="primary" onClick={() => setShow(true)}>
          Publish content
        </button>
      </Heading>
      <Listing
        name="content"
        columns={[
          ["kind", "Kind"],
          ["title", "Title"],
          ["version", "Version"],
          ["required", "Required"],
          ["active", "Current"],
        ]}
      />
      {show && (
        <Modal title="Publish a content version" onClose={() => setShow(false)}>
          <Form
            fields={[
              {
                name: "kind",
                label: "Kind",
                required: true,
                options: choices([
                  "lesson",
                  "script",
                  "knowledge",
                  "announcement",
                  "quiz",
                  ...(app.has("owner") ? ["agreement"] : []),
                ]),
              },
              {
                name: "slug",
                label: "Stable reference name",
                required: true,
                hint: "Reuse this name to publish a new version of the same content.",
              },
              { name: "title", label: "Title", required: true },
              {
                name: "body",
                label: "Content",
                type: "textarea",
                required: true,
                hint: "For a quiz, enter an array of question and options objects as JSON.",
              },
              {
                name: "answers",
                label: "Quiz answer indexes (quiz only)",
                hint: "JSON array of zero-based correct option indexes; never put answers in the question text.",
              },
              {
                name: "required",
                label: "Required for onboarding",
                type: "checkbox",
              },
              {
                name: "reason",
                label: "Publication reason",
                type: "textarea",
                required: true,
              },
            ]}
            submit="Publish version"
            onSubmit={async (p) => {
              if (p.kind === "quiz") {
                try {
                  const questions = JSON.parse(p.body),
                    answers = JSON.parse(p.answers);
                  if (
                    !Array.isArray(questions) ||
                    questions.length !== answers.length ||
                    questions.some(
                      (q: Row, i: number) =>
                        !q.question ||
                        !Array.isArray(q.options) ||
                        !Number.isInteger(answers[i]) ||
                        answers[i] < 0 ||
                        answers[i] >= q.options.length,
                    )
                  )
                    throw Error();
                  p.answers = answers;
                } catch {
                  throw Error(
                    "Enter valid questions and a matching answer key.",
                  );
                }
              } else delete p.answers;
              await app.mutate("content", p);
              setShow(false);
            }}
          />
        </Modal>
      )}
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
