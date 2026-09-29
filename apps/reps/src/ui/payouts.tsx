import { useState } from "react";
import { CheckCircle2, Copy, Clock3, ShieldCheck } from "lucide-react";
import {
  useApp,
  useData,
  Card,
  State,
  Form,
  Modal,
  Heading,
  Table,
  LinkButton,
  type Field,
} from "./lib";
import { type Row } from "../shared/core";
import { payoutInput, payoutLabels, payoutMessages } from "../shared/payouts";

function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        <Copy size={15} aria-hidden="true" /> {copied ? "Copied" : label}
      </button>
      {error && <span role="status">Select and copy the text manually.</span>}
    </>
  );
}
const payoutFields: Field[] = [
  {
    name: "email",
    label: "Email",
    type: "email",
    autoComplete: "email",
    required: true,
    maxLength: 254,
  },
  {
    name: "phone",
    label: "Phone number",
    type: "tel",
    autoComplete: "tel",
    required: true,
    maxLength: 30,
    hint: "Include the country code for numbers outside the US.",
  },
  {
    name: "legal_first_name",
    label: "Legal first name (as it appears on your ID)",
    autoComplete: "given-name",
    required: true,
    maxLength: 100,
  },
  {
    name: "legal_last_name",
    label: "Legal last name (as it appears on your ID)",
    autoComplete: "family-name",
    required: true,
    maxLength: 100,
  },
  {
    name: "acknowledged",
    label:
      "I confirm this information is accurate and understand that Stripe will contact me separately to securely collect the payout information required to receive commissions.",
    type: "checkbox",
    required: true,
  },
];
export function PayoutSetup() {
  const app = useApp(),
    state = useData("/report?kind=payout_setup", 15000),
    [open, setOpen] = useState(false);
  const setup = state.data?.setup,
    status = setup?.status || "not_started";
  return (
    <section id="onboarding-payout" tabIndex={-1} className="card">
      <h2>Payout setup</h2>
      <State {...state}>
        <div className="payout-status">
          <ShieldCheck aria-hidden="true" />
          <strong>{payoutLabels[status]}</strong>
        </div>
        <p>{payoutMessages[status]}</p>
        {setup?.correction_reason && (
          <p className="notice" role="status">
            {setup.correction_reason}
          </p>
        )}
        <p className="muted">
          Pixelalty does not collect or store your bank account or routing
          number. Never send banking details, SSNs, or verification codes
          through this form or support.
        </p>
        {["not_started", "needs_correction"].includes(status) && (
          <button className="primary" onClick={() => setOpen(true)}>
            {status === "not_started"
              ? "Set Up Payouts"
              : "Update payout information"}
          </button>
        )}
      </State>
      {open && (
        <Modal title="Set up payouts" onClose={() => setOpen(false)}>
          <p>
            Provide only your contact information and legal name. Stripe
            collects banking information separately.
          </p>
          <Form
            fields={payoutFields}
            initial={{
              email: setup?.email || state.data?.email || "",
              phone: setup?.phone || state.data?.phone || "",
              legal_first_name: setup?.legal_first_name || "",
              legal_last_name: setup?.legal_last_name || "",
            }}
            submit="Submit payout setup"
            onSubmit={async (values) => {
              const result = payoutInput.safeParse(values);
              if (!result.success)
                throw Error(
                  result.error.issues[0]?.message ||
                    "Check the information and acknowledgment.",
                );
              await app.mutate("payout_submit", result.data);
              setOpen(false);
              app.notify(
                "Payout setup submitted. Pixelalty will review it within 24 hours.",
              );
            }}
          />
        </Modal>
      )}
    </section>
  );
}

export function SalesCode({
  repId,
  manage = false,
}: {
  repId?: string;
  manage?: boolean;
}) {
  const app = useApp(),
    state = useData(
      "/report?kind=sales_code" +
        (repId ? "&id=" + encodeURIComponent(repId) : ""),
      15000,
    ),
    [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false);
  const code = state.data?.code;
  return (
    <section
      id="onboarding-sales-code"
      tabIndex={-1}
      className="card sales-code-card"
    >
      <h2>{manage ? "Sales Code" : "My Sales Code"}</h2>
      <State {...state}>
        {code ? (
          <>
            <div className="sales-code-value">{code.code}</div>
            <p>
              Customers receive: <strong>2% off</strong>
              <br />
              Your normal commission: <strong>Unchanged</strong>
            </p>
            <CopyButton value={code.code} label="Copy Code" />
            <p>
              Give this code to a customer and ask them to enter it during
              Stripe checkout. It gives them 2% off and attributes a
              successfully paid sale to you.
            </p>
            <p className="payout-status">
              <CheckCircle2 size={18} aria-hidden="true" /> Sales code assigned
            </p>
          </>
        ) : (
          <>
            <div className="payout-status">
              <Clock3 aria-hidden="true" />
              <strong>Waiting for assigned code</strong>
            </div>
            <p>
              Pixelalty will assign your customer promotion code before you
              begin calling.
            </p>
            <p className="muted">Sales code assigned · Waiting for Pixelalty</p>
          </>
        )}
        {manage && (
          <>
            <p className="muted">
              Create the actual 2% promotion code in your Stripe Dashboard
              first. This form only manages Pixelalty’s rep mapping; it does not
              create or change anything in Stripe.
            </p>
            <div className="actions">
              <button onClick={() => setEdit(true)}>
                {code ? "Change Code" : "Add Code"}
              </button>
              {code && (
                <button className="danger" onClick={() => setRemove(true)}>
                  Deactivate Code
                </button>
              )}
            </div>
          </>
        )}
      </State>
      {edit && (
        <Modal
          title={code ? "Change sales code" : "Add sales code"}
          onClose={() => setEdit(false)}
        >
          <p>
            Customer discount: 2% (fixed). Enter the exact code you already
            created in Stripe.
          </p>
          <Form
            fields={[
              {
                name: "code",
                label: "Promotion code",
                required: true,
                minLength: 2,
                maxLength: 24,
                pattern: "[A-Za-z0-9]{2,24}",
                hint: "2–24 letters and numbers. Saved in uppercase.",
              },
              {
                name: "stripe_promotion_code_id",
                label: "Stripe promotion code reference (optional)",
                pattern: "promo_[A-Za-z0-9]{3,100}",
                maxLength: 106,
              },
            ]}
            initial={{ code: code?.code || "" }}
            submit="Save Code"
            onSubmit={async (p) => {
              await app.mutate("sales_code_save", { ...p, id: repId });
              setEdit(false);
              app.notify("Sales code saved.");
            }}
          />
        </Modal>
      )}
      {remove && (
        <Modal title="Deactivate sales code" onClose={() => setRemove(false)}>
          <p>
            Future payments will not be credited through this mapping.
            Historical sales and commissions stay attached to this rep. Their
            checklist will return to waiting for an assigned code.
          </p>
          <Form
            fields={[
              {
                name: "confirmed",
                label:
                  "I understand this deactivates only the Pixelalty mapping, not the Stripe code.",
                type: "checkbox",
                required: true,
              },
            ]}
            submit="Deactivate Code"
            onSubmit={async () => {
              await app.mutate("sales_code_remove", { id: repId });
              setRemove(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

export function PayoutSetupAdmin() {
  const app = useApp(),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(0),
    [target, setTarget] = useState<Row | null>(null),
    [action, setAction] = useState("");
  const state = useData(
    `/report?kind=payout_setup_queue&status=${status}&page=${page}`,
    15000,
  );
  const selected =
    state.data?.rows.find((r: Row) => r.rep_id === target?.rep_id) || target;
  const actionLabel: Record<string, string> = {
    payout_sent: "Mark Stripe setup sent",
    payout_ready: "Approve payout setup",
    payout_correction: "Request correction",
  };
  return (
    <>
      <Heading
        title="Payout Setup"
        description="Review safe contact information, then track the Stripe steps you complete manually."
      />
      <LinkButton to="/admin/finance">Back to Finance</LinkButton>
      <Card>
        <p>
          In your own browser: Stripe → Global Payouts → Recipients → Add
          recipient. Choose Stripe’s option to collect details from the
          recipient. These Pixelalty actions only record your progress; they do
          not call Stripe or verify bank information.
        </p>
        <label htmlFor="payout-filter">Status</label>
        <select
          id="payout-filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All</option>
          {Object.entries(payoutLabels)
            .filter(([k]) => k !== "not_started")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
        <State
          {...state}
          empty={!state.data?.rows.length}
          emptyText="No payout submissions match this filter."
        >
          <Table
            rows={(state.data?.rows || []).map((r: Row) => ({
              ...r,
              legal_name: r.legal_first_name + " " + r.legal_last_name,
              status_label: payoutLabels[r.status],
            }))}
            columns={[
              ["rep_name", "Rep"],
              ["rep_code", "Rep ID"],
              ["legal_name", "Legal name"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["submitted_at", "Submitted"],
              ["status_label", "Status"],
              ["updated_at", "Updated"],
            ]}
            actions={(r) => (
              <button
                onClick={() => {
                  setTarget(r);
                  setAction("");
                }}
              >
                View
              </button>
            )}
          />
        </State>
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button
            disabled={(page + 1) * 50 >= (state.data?.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </Card>
      {selected && (
        <Modal
          title={`Payout setup · ${selected.rep_name}`}
          onClose={() => {
            setTarget(null);
            setAction("");
          }}
        >
          <p>
            {selected.rep_code} · {payoutLabels[selected.status]}
          </p>
          <div className="payout-details">
            {[
              ["legal_first_name", "Legal first name"],
              ["legal_last_name", "Legal last name"],
              ["email", "Email"],
              ["phone", "Phone"],
            ].map(([key, title]) => (
              <div key={key}>
                <strong>{title}</strong>
                <span>{selected[key]}</span>
                <CopyButton
                  value={selected[key]}
                  label={`Copy ${title.toLowerCase()}`}
                />
              </div>
            ))}
          </div>
          <CopyButton
            value={`${selected.legal_first_name} ${selected.legal_last_name}\n${selected.email}\n${selected.phone}`}
            label="Copy all"
          />
          <p>Submitted {new Date(selected.submitted_at).toLocaleString()}</p>
          {selected.correction_reason && <p>{selected.correction_reason}</p>}
          {!action && (
            <div className="actions">
              {selected.status === "submitted" && (
                <button onClick={() => setAction("payout_sent")}>
                  Mark Stripe setup sent
                </button>
              )}
              {selected.status === "stripe_setup_pending" && (
                <button
                  className="primary"
                  onClick={() => setAction("payout_ready")}
                >
                  Approve payout setup
                </button>
              )}
              {["submitted", "stripe_setup_pending"].includes(
                selected.status,
              ) && (
                <button onClick={() => setAction("payout_correction")}>
                  Request correction
                </button>
              )}
            </div>
          )}
          {action && (
            <Form
              key={action}
              fields={[
                ...(action === "payout_correction"
                  ? [
                      {
                        name: "reason",
                        label:
                          "Correction reason (no banking or sensitive information)",
                        type: "textarea",
                        required: true,
                        minLength: 5,
                        maxLength: 500,
                      },
                    ]
                  : [
                      {
                        name: "stripe_recipient_reference",
                        label:
                          "Stripe recipient reference (optional, not a secret)",
                        maxLength: 110,
                      },
                    ]),
                {
                  name: "confirmed",
                  label:
                    action === "payout_sent"
                      ? "I created the recipient in Stripe and instructed Stripe to send the secure setup email."
                      : action === "payout_ready"
                        ? "I personally checked Stripe and confirmed this recipient is ready to receive payouts."
                        : "I reviewed the request and confirm this correction is needed.",
                  type: "checkbox",
                  required: true,
                },
              ]}
              submit={actionLabel[action]}
              onSubmit={async (p) => {
                await app.mutate(action, {
                  ...p,
                  id: selected.rep_id,
                  expected_status: selected.status,
                });
                setTarget(null);
                setAction("");
                app.notify("Payout progress updated.");
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
