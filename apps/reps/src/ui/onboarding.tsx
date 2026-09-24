import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LockKeyhole,
} from "lucide-react";
import {
  api,
  useApp,
  useData,
  Heading,
  Card,
  State,
  Modal,
  Form,
  LinkButton,
  Badge,
  ActionDialog,
  uploadPdf,
  download,
} from "./lib";
import { OnboardingProgress } from "./details";
import { label, type Row } from "../shared/core";

const taxLabels: Record<string, string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  under_review: "Under review",
  verified: "Verified",
  needs_correction: "Needs correction",
  archived: "Archived",
};
const reasons = [
  { value: "signature", label: "Required signature or date missing" },
  { value: "incomplete", label: "Required fields incomplete" },
  { value: "unreadable", label: "PDF is not readable" },
  { value: "wrong_document", label: "Incorrect tax document" },
  { value: "updated_form", label: "Updated form required" },
];
function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <div className="onboarding-wait">
      <Clock3 size={18} aria-hidden="true" />
      <div>
        <strong>Waiting for Pixelalty</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}
export function Onboarding() {
  const app = useApp(),
    readiness = useData("/report?kind=onboarding", 30000),
    agreements = useData(
      "/table?name=content&kind=agreement&active=true",
      60000,
    ),
    accepted = useData("/table?name=agreements&own=true"),
    [item, setItem] = useState<Row | null>(null),
    [payoutBusy, setPayoutBusy] = useState(false),
    [payoutError, setPayoutError] = useState("");
  const d = readiness.data,
    classification = d?.classification;
  const payout = async (refresh: boolean) => {
    setPayoutBusy(true);
    setPayoutError("");
    try {
      const result = await api("/connect", { refresh });
      if (refresh) {
        app.refresh();
        app.notify("Payment setup status updated.");
      } else location.assign(result.url);
    } catch (e) {
      setPayoutError(
        e instanceof Error
          ? e.message
          : "Payment setup could not be opened. Please try again.",
      );
    } finally {
      setPayoutBusy(false);
    }
  };
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const step = query.get("step");
    if (
      ["agreement", "classification", "tax", "payout", "activation"].includes(
        step || "",
      )
    ) {
      const node = document.getElementById("onboarding-" + step);
      node?.scrollIntoView({ block: "center" });
      node?.focus({ preventScroll: true });
    }
  }, [app.path, readiness.loading]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("connect")) {
      history.replaceState({}, "", "/onboarding?step=payout");
      void payout(true);
    }
  }, []);
  useEffect(() => {
    if (d?.status === "active" && app.ctx.rep?.status !== "active") {
      void app.reloadContext();
      app.navigate("/");
      app.notify("Your account is active. Welcome to your sales workspace.");
    }
  }, [d?.status]);
  return (
    <>
      <Heading
        title="Welcome to Pixelalty."
        description="Your next steps, and the reviews our team will take care of."
      />
      <OnboardingProgress />
      <State {...readiness}>
        <div className="onboarding-grid">
          <Card title="Your profile">
            <p>Save your name and timezone so your workspace is ready.</p>
            <LinkButton to="/profile">Complete profile</LinkButton>
          </Card>
          <section id="onboarding-agreement" tabIndex={-1} className="card">
            <h2>Required agreement</h2>
            <State {...agreements}>
              {!d?.agreement_available ? (
                <Waiting>
                  Waiting for Pixelalty to publish your agreement.
                </Waiting>
              ) : (
                agreements.data?.rows
                  .filter((r: Row) => r.required)
                  .map((r: Row) => {
                    const receipt = accepted.data?.rows.find(
                      (a: Row) => a.content_id === r.id,
                    );
                    return (
                      <article className="activity" key={r.id}>
                        <h3>{r.title}</h3>
                        <p>
                          Version {r.version}
                          {receipt
                            ? " · Accepted " +
                              new Date(receipt.created_at).toLocaleDateString()
                            : " · Your review is required"}
                        </p>
                        <button
                          className={receipt ? "" : "primary"}
                          onClick={() => setItem(r)}
                        >
                          {receipt
                            ? "View accepted agreement"
                            : "Review & Accept Agreement"}
                        </button>
                      </article>
                    );
                  })
              )}
            </State>
          </section>
          <section
            id="onboarding-classification"
            tabIndex={-1}
            className="card"
          >
            <h2>Worker classification</h2>
            {classification === "unconfigured" ? (
              <Waiting>Waiting for Pixelalty review.</Waiting>
            ) : (
              <p>
                <CheckCircle2 size={18} aria-hidden="true" /> Pixelalty has
                reviewed your classification:{" "}
                <strong>{label(classification)}</strong>.
              </p>
            )}
            <p className="muted">
              Pixelalty reviews this with you. Your legal worker classification
              is not a profile preference.
            </p>
          </section>
          <section id="onboarding-tax" tabIndex={-1} className="card">
            <h2>Tax documentation</h2>
            {classification === "contractor" ? (
              <TaxSubmission />
            ) : (
              <Waiting>
                {classification === "employee"
                  ? "Pixelalty Finance will verify your employee tax setup through the approved payroll process."
                  : "Your worker classification must be reviewed before tax-document submission."}
              </Waiting>
            )}
          </section>
          <section id="onboarding-payout" tabIndex={-1} className="card">
            <h2>Payment setup</h2>
            {classification === "contractor" ? (
              <>
                <p>
                  {d?.payout?.ready
                    ? "Your payout account is ready."
                    : d?.payout?.started
                      ? "Your payout setup needs attention. Continue securely to review any outstanding information."
                      : "Add your payout details through our secure payment partner. Pixelalty does not collect your banking credentials."}
                </p>
                <State error={payoutError} />
                <div className="actions">
                  <button
                    className="primary"
                    disabled={payoutBusy}
                    onClick={() => void payout(false)}
                  >
                    {payoutBusy
                      ? "Opening securely…"
                      : d?.payout?.ready
                        ? "Review payout details"
                        : "Set Up Payouts Securely"}
                  </button>
                  <button
                    disabled={payoutBusy}
                    onClick={() => void payout(true)}
                  >
                    Check payment setup status
                  </button>
                </div>
              </>
            ) : (
              <Waiting>
                {classification === "employee"
                  ? "Pixelalty Finance will verify your payroll setup."
                  : "Pixelalty must review your worker classification before payout setup is available."}
              </Waiting>
            )}
          </section>
          <Card title="Training & readiness quiz">
            <p>Complete the required lessons, then pass your readiness quiz.</p>
            <LinkButton to="/academy">Continue in the Academy</LinkButton>
          </Card>
          <section id="onboarding-activation" tabIndex={-1} className="card">
            <h2>Administrator activation</h2>
            {d?.status === "active" ? (
              <>
                <p>Your account is active.</p>
                <LinkButton to="/">Open your sales workspace</LinkButton>
              </>
            ) : (
              <>
                <Waiting>Waiting for Pixelalty activation.</Waiting>
                <p>
                  {d?.ready
                    ? "All required steps are complete. Your account is ready for the team’s final activation."
                    : "Finish your actions above. Pixelalty will complete the remaining reviews."}
                </p>
              </>
            )}
            <LinkButton to="/support">Contact Pixelalty</LinkButton>
          </section>
        </div>
      </State>
      {item && (
        <Modal title={item.title} onClose={() => setItem(null)}>
          <p className="muted">Agreement version {item.version}</p>
          <div className="prose agreement">{item.body}</div>
          {accepted.data?.rows.some((a: Row) => a.content_id === item.id) ? (
            <p className="notice success">
              Your acceptance of this version is saved.
            </p>
          ) : (
            <Form
              fields={[
                {
                  name: "signature",
                  label: "Your full legal name",
                  required: true,
                  minLength: 2,
                },
                {
                  name: "accepted",
                  label: "I have read and agree to this version.",
                  type: "checkbox",
                  required: true,
                },
              ]}
              submit="Accept agreement"
              onSubmit={async (p) => {
                await app.mutate("agreement", { ...p, content_id: item.id });
                setItem(null);
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}

function TaxSubmission() {
  const app = useApp(),
    state = useData("/tax", 30000),
    [file, setFile] = useState<File | null>(null),
    [requestId, setRequestId] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const status = state.data?.status || "not_submitted";
  return (
    <State {...state}>
      <div className="tax-status">
        <FileCheck2 size={20} aria-hidden="true" />
        <strong>{taxLabels[status]}</strong>
      </div>
      {state.data?.document?.submitted_at && (
        <p className="muted">
          Submitted{" "}
          {new Date(state.data.document.submitted_at).toLocaleString()}
        </p>
      )}
      {status === "needs_correction" && (
        <p className="notice error">{state.data.document.correction_reason}</p>
      )}
      {["submitted", "under_review"].includes(status) && (
        <Waiting>
          Your PDF is saved securely. Pixelalty Finance will review it.
        </Waiting>
      )}
      {status === "verified" && (
        <p className="notice success">Your tax document has been verified.</p>
      )}
      <a
        className="button"
        href="https://www.irs.gov/pub/irs-pdf/fw9.pdf"
        target="_blank"
        rel="noreferrer"
      >
        Download official IRS Form W-9
      </a>
      <p>
        Complete the applicable form and sign it. For the IRS interactive form,
        use Print → Save as PDF, then check that every entry and your signature
        are visible. Upload that PDF. If Form W-9 does not apply to you, contact
        Pixelalty Finance before submitting.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setError("");
          if (
            !file ||
            !/\.pdf$/i.test(file.name) ||
            (file.type && file.type !== "application/pdf")
          ) {
            setError("Choose a PDF file.");
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            setError("Your PDF must be 5 MB or smaller.");
            return;
          }
          setBusy(true);
          try {
            await uploadPdf(file, requestId);
            form.reset();
            setFile(null);
            setRequestId(crypto.randomUUID());
            app.refresh();
            app.notify(
              "Your document was submitted securely for Finance review.",
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Upload failed. Please retry.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Completed, signed W-9 PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            required
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setError("");
              setRequestId(crypto.randomUUID());
            }}
            aria-describedby="tax-file-help"
          />
        </label>
        <small id="tax-file-help">
          PDF only, up to 5 MB. No password protection, embedded files or
          scripts.
        </small>
        {status !== "not_submitted" && (
          <p className="notice">
            Replacing your document restarts Finance review. The previous
            submission is archived securely.
          </p>
        )}
        <State error={error} />
        <button className="primary" disabled={busy || !file}>
          {busy
            ? "Uploading securely…"
            : status === "not_submitted"
              ? "Submit W-9 securely"
              : "Replace W-9 securely"}
        </button>
      </form>
      <p className="muted">
        <LockKeyhole size={15} aria-hidden="true" /> Only authorized Owner and
        Finance accounts can download your submitted PDF. Never put a tax ID in
        profile fields, messages or filenames.
      </p>
    </State>
  );
}

export function RepOnboardingDetail({ code }: { code: string }) {
  const app = useApp(),
    state = useData("/report?kind=onboarding&code=" + encodeURIComponent(code)),
    [dialog, setDialog] = useState<
      "classification" | "activate" | "payroll" | null
    >(null),
    d = state.data;
  const missing = (d?.steps || []).filter(
    (s: Row) => s.required && !s.complete && s.key !== "activation",
  );
  return (
    <>
      <Heading
        title={d?.rep?.name || "Rep onboarding"}
        description="Review each requirement and complete the actions assigned to your role."
      >
        <LinkButton to="/admin/reps">All reps</LinkButton>
      </Heading>
      <State {...state}>
        {d && (
          <>
            <div className="card-head">
              <span className="eyebrow">{d.rep.code}</span>
              <Badge value={d.status} />
            </div>
            <Card
              title={d.ready ? "Ready for activation" : "Can’t activate yet"}
            >
              {missing.length ? (
                <ul className="readiness-missing">
                  {missing.map((s: Row) => (
                    <li key={s.key}>
                      <strong>{s.title}</strong>
                      <p>{s.message}</p>
                      <AdminRequirementAction
                        step={s.key}
                        code={code}
                        agreementAvailable={d.agreement_available}
                        onClassification={() => setDialog("classification")}
                        onPayroll={() => setDialog("payroll")}
                        classification={d.classification}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Every required onboarding gate is complete.</p>
              )}
              {app.has("sales_admin") && d.status !== "active" && (
                <>
                  <button
                    className="primary"
                    disabled={!d.ready}
                    onClick={() => setDialog("activate")}
                  >
                    Activate Rep
                  </button>
                  {!d.ready && (
                    <p className="muted">
                      Resolve the requirements above to enable activation.
                    </p>
                  )}
                </>
              )}
              {d.status === "active" && (
                <p className="notice success">
                  This rep can use the active sales workspace.
                </p>
              )}
            </Card>
            <div className="onboarding-grid">
              <Card title="Classification review">
                <p>{label(d.classification)}</p>
                {app.has("sales_admin") && (
                  <button onClick={() => setDialog("classification")}>
                    Review worker classification
                  </button>
                )}
                <p className="muted">
                  Changes require a reason and are saved in the audit history.
                </p>
              </Card>
              <Card title="Tax & payment reviews">
                <p>
                  Tax:{" "}
                  {d.classification === "employee"
                    ? label(d.external_tax_status)
                    : taxLabels[d.tax_status]}
                </p>
                <p>
                  Payment setup:{" "}
                  {d.steps.find((s: Row) => s.key === "payout")?.complete
                    ? "Ready"
                    : "Incomplete"}
                </p>
                {app.has("finance_admin") &&
                  d.classification === "contractor" && (
                    <LinkButton to={"/admin/tax?rep_code=" + code}>
                      Review tax document
                    </LinkButton>
                  )}
                {app.has("finance_admin") &&
                  d.classification === "employee" && (
                    <button onClick={() => setDialog("payroll")}>
                      Review employee tax & payroll
                    </button>
                  )}
                <p className="muted">
                  Payout status updates from verified payment-provider events
                  and the rep’s secure setup flow.
                </p>
              </Card>
            </div>
            <Card title="Current requirements">
              <div className="checklist">
                {d.steps.map((s: Row) => (
                  <div className="health-row" key={s.key}>
                    <span>{s.title}</span>
                    <strong>
                      {s.complete
                        ? "Complete"
                        : !s.required
                          ? "Not required"
                          : s.actor === "rep"
                            ? "Rep action"
                            : "Pixelalty review"}
                    </strong>
                  </div>
                ))}
              </div>
            </Card>
            {d.classification_history?.length > 0 && (
              <Card title="Classification & payroll history">
                {d.classification_history.map((event: Row, i: number) => (
                  <article className="activity" key={i}>
                    <strong>
                      {event.action === "rep_classification"
                        ? label(event.details.before) +
                          " → " +
                          label(event.details.after)
                        : "Employee setup reviewed"}
                    </strong>
                    <p>{event.reason}</p>
                    <small>
                      {event.actor} ·{" "}
                      {new Date(event.created_at).toLocaleString()}
                    </small>
                  </article>
                ))}
              </Card>
            )}
            {dialog === "classification" && (
              <ActionDialog
                title="Review worker classification"
                action="rep_classification"
                initial={{
                  id: d.rep.id,
                  classification:
                    d.classification === "unconfigured" ? "" : d.classification,
                }}
                fields={[
                  {
                    name: "classification",
                    label: "Worker classification",
                    required: true,
                    options: [
                      { value: "contractor", label: "Contractor" },
                      { value: "employee", label: "Employee" },
                    ],
                  },
                ]}
                onClose={() => setDialog(null)}
              />
            )}
            {dialog === "payroll" && (
              <ActionDialog
                title="Verify employee tax & payroll"
                action="rep_payroll"
                initial={{
                  id: d.rep.id,
                  tax_verified: d.external_tax_status === "verified",
                  payout_verified: d.external_payout_verified,
                }}
                fields={[
                  {
                    name: "tax_verified",
                    label:
                      "Employee tax setup verified through the approved process",
                    type: "checkbox",
                  },
                  {
                    name: "payout_verified",
                    label: "Approved payroll setup verified",
                    type: "checkbox",
                  },
                ]}
                onClose={() => setDialog(null)}
              />
            )}
            {dialog === "activate" && (
              <ActionDialog
                title="Activate Rep"
                action="rep_activate"
                initial={{ id: d.rep.id }}
                onClose={() => setDialog(null)}
              />
            )}
          </>
        )}
      </State>
    </>
  );
}

function AdminRequirementAction({
  step,
  code,
  agreementAvailable,
  classification,
  onClassification,
  onPayroll,
}: {
  step: string;
  code: string;
  agreementAvailable: boolean;
  classification: string;
  onClassification: () => void;
  onPayroll: () => void;
}) {
  const app = useApp();
  if (step === "classification" && app.has("sales_admin"))
    return <button onClick={onClassification}>Review classification</button>;
  if (step === "agreement" && !agreementAvailable && app.has("owner"))
    return (
      <LinkButton to="/admin/content?kind=agreement">
        Publish required agreement
      </LinkButton>
    );
  if (
    (step === "tax" || step === "payout") &&
    classification === "employee" &&
    app.has("finance_admin")
  )
    return <button onClick={onPayroll}>Review employee setup</button>;
  if (
    step === "tax" &&
    classification === "contractor" &&
    app.has("finance_admin")
  )
    return (
      <LinkButton to={"/admin/tax?rep_code=" + code}>
        Review tax submission
      </LinkButton>
    );
  return (
    <small className="muted">
      {step === "tax"
        ? "Finance review is required."
        : step === "payout"
          ? "The rep completes secure payout setup from Onboarding."
          : "The rep completes this action from their onboarding checklist."}
    </small>
  );
}

export function TaxReview() {
  const app = useApp(),
    code = new URLSearchParams(app.path.split("?")[1]).get("rep_code");
  return code ? <TaxRepReview code={code} /> : <TaxQueue />;
}
function TaxQueue() {
  const [page, setPage] = useState(1),
    state = useData("/report?kind=tax_queue&page=" + page);
  return (
    <>
      <Heading
        title="Tax document review"
        description="Private documents. Owner and Finance access only; every download and decision is recorded."
      />
      <State
        {...state}
        empty={!state.data?.rows.length}
        emptyText="No tax documents have been submitted yet."
      >
        <div className="onboarding-grid">
          {state.data?.rows.map((r: Row) => (
            <Card key={r.id} title={r.name}>
              <p>
                {r.code} · {taxLabels[r.status]}
              </p>
              <p className="muted">
                Submitted {new Date(r.submitted_at).toLocaleString()}
              </p>
              <LinkButton to={"/admin/tax?rep_code=" + r.code}>
                Review submission
              </LinkButton>
            </Card>
          ))}
        </div>
        <QueuePagination
          page={page}
          total={state.data?.total || 0}
          onPage={setPage}
        />
      </State>
    </>
  );
}
function TaxRepReview({ code }: { code: string }) {
  const state = useData(
    "/report?kind=onboarding&code=" + encodeURIComponent(code),
  );
  return (
    <>
      <Heading
        title={
          state.data?.rep?.name
            ? "Tax review · " + state.data.rep.name
            : "Tax review"
        }
      >
        <LinkButton to="/admin/tax">Review queue</LinkButton>
      </Heading>
      <State {...state}>
        {state.data?.rep && <TaxDocumentReview rep={state.data.rep} />}
      </State>
    </>
  );
}
function TaxDocumentReview({ rep }: { rep: Row }) {
  const app = useApp(),
    state = useData("/tax?rep=" + rep.id),
    [action, setAction] = useState("");
  const doc = state.data?.document;
  const perform = async (kind: string, data: Row = {}) => {
    await api("/tax/review", { action: kind, id: doc.id, ...data });
    app.refresh();
    setAction("");
    app.notify("Tax-document review saved.");
  };
  return (
    <State {...state}>
      <Card title={taxLabels[state.data?.status || "not_submitted"]}>
        {!doc ? (
          <p>This rep has not submitted a current document.</p>
        ) : (
          <>
            <p>
              Submitted {new Date(doc.submitted_at).toLocaleString()} ·{" "}
              {(doc.bytes / 1024).toFixed(0)} KB
            </p>
            <p>
              Review the signed PDF through the authorized download. Do not copy
              a tax ID into notes or other application fields.
            </p>
            <div className="actions">
              <button
                className="primary"
                onClick={() =>
                  app.run(async () => {
                    if (doc.status === "submitted")
                      await perform("start_review");
                    await download(
                      "/tax/document",
                      "pixelalty-tax-document.pdf",
                      { id: doc.id },
                    );
                    app.refresh();
                  })
                }
              >
                Download PDF for review
              </button>
              {["submitted", "under_review"].includes(doc.status) && (
                <button onClick={() => setAction("verify")}>
                  Verify tax document
                </button>
              )}
              <button onClick={() => setAction("request_correction")}>
                Request correction
              </button>
              <button onClick={() => setAction("archive")}>
                Archive document
              </button>
            </div>
            {doc.correction_reason && (
              <p className="notice">{doc.correction_reason}</p>
            )}
          </>
        )}
        {action && (
          <Modal
            title={
              action === "verify"
                ? "Verify tax document"
                : action === "archive"
                  ? "Archive document"
                  : "Request correction"
            }
            onClose={() => setAction("")}
          >
            <p>
              {action === "verify"
                ? "Confirm you have reviewed this completed document under Pixelalty’s approved tax-document process. This records your review; it does not validate a taxpayer ID with the IRS."
                : action === "archive"
                  ? "This removes the current verification and keeps the PDF in restricted history. It does not permanently delete the document."
                  : "Choose what the rep needs to correct. Tax IDs must never be included in a message."}
            </p>
            <Form
              fields={
                action === "verify"
                  ? [
                      {
                        name: "reviewed",
                        label: "I have reviewed this submitted document",
                        type: "checkbox",
                        required: true,
                      },
                    ]
                  : [
                      {
                        name: "reason_code",
                        label: "Reason",
                        required: true,
                        options:
                          action === "archive"
                            ? [
                                {
                                  value: "incorrect",
                                  label: "Incorrect document",
                                },
                                {
                                  value: "requested",
                                  label: "Account holder requested archive",
                                },
                                {
                                  value: "retention",
                                  label: "Approved retention policy",
                                },
                              ]
                            : reasons,
                      },
                    ]
              }
              submit={
                action === "verify"
                  ? "Verify document"
                  : action === "archive"
                    ? "Archive document"
                    : "Send correction request"
              }
              onSubmit={(p) => perform(action, p)}
            />
          </Modal>
        )}
      </Card>
      <Card title="Document history">
        {state.data?.history?.map((h: Row) => (
          <article key={h.id} className="activity">
            <strong>{taxLabels[h.status]}</strong>
            <p>{new Date(h.submitted_at).toLocaleString()}</p>
            {!h.current && (
              <button
                onClick={() =>
                  app.run(async () => {
                    await download(
                      "/tax/document",
                      "pixelalty-tax-document.pdf",
                      { id: h.id },
                    );
                    app.refresh();
                  })
                }
              >
                Download archived PDF
              </button>
            )}
          </article>
        ))}
      </Card>
      <Card title="Audit history">
        {state.data?.events?.length ? (
          state.data.events.map((e: Row, i: number) => (
            <article className="activity" key={i}>
              <strong>{label(e.event)}</strong>
              <p>{e.reason}</p>
              <small>
                {e.actor} ·{" "}
                <time>{new Date(e.created_at).toLocaleString()}</time>
              </small>
            </article>
          ))
        ) : (
          <p>No document events yet.</p>
        )}
      </Card>
    </State>
  );
}

export function OperationsQueue({ compact = false }: { compact?: boolean }) {
  const app = useApp(),
    [page, setPage] = useState(1),
    state = useData("/report?kind=operations&page=" + page),
    d = state.data;
  return (
    <Card title="Needs attention">
      <State {...state}>
        {d && (
          <>
            <div className="operations-counts">
              {app.has("sales_admin") && (
                <LinkButton to="/admin/recruiting">
                  {d.applicants} applications to review
                </LinkButton>
              )}
              {d.can_review_tax && (
                <LinkButton to="/admin/tax">
                  {d.tax_review} tax documents awaiting review
                </LinkButton>
              )}
              {d.failed_emails > 0 &&
                (app.has("owner") ? (
                  <LinkButton to="/admin/health">
                    {d.failed_emails} emails need attention
                  </LinkButton>
                ) : (
                  <p className="muted">
                    {d.failed_emails} emails are waiting for Owner review.
                  </p>
                ))}
              {d.webhook_issues > 0 && (
                <LinkButton to="/admin/finance">
                  {d.webhook_issues} payment events need review
                </LinkButton>
              )}
            </div>
            {d.reps.length ? (
              <div className="onboarding-queue">
                {d.reps.slice(0, compact ? 6 : 100).map((r: Row) => (
                  <article className="activity" key={r.code}>
                    <div className="card-head">
                      <strong>{r.name}</strong>
                      <span
                        className={r.readiness.ready ? "badge active" : "badge"}
                      >
                        {r.readiness.ready ? "Ready to activate" : "Onboarding"}
                      </span>
                    </div>
                    <p>
                      {r.readiness.ready
                        ? "All required gates are complete."
                        : r.readiness.steps
                            .filter(
                              (s: Row) =>
                                s.required &&
                                !s.complete &&
                                s.key !== "activation",
                            )
                            .map((s: Row) => s.title)
                            .join(" · ")}
                    </p>
                    <LinkButton
                      to={
                        (app.has("sales_admin")
                          ? "/admin/reps?rep_code="
                          : "/admin/tax?rep_code=") + r.code
                      }
                    >
                      Manage onboarding <ArrowRight size={15} />
                    </LinkButton>
                  </article>
                ))}
              </div>
            ) : (
              <p>No reps are waiting for onboarding.</p>
            )}
            {!compact && (
              <QueuePagination page={page} total={d.total} onPage={setPage} />
            )}
            {compact && d.total > 6 && (
              <LinkButton to="/admin/reps">View all onboarding reps</LinkButton>
            )}
          </>
        )}
      </State>
    </Card>
  );
}

function QueuePagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= 50) return null;
  return (
    <nav className="actions queue-pagination" aria-label="Queue pages">
      <button disabled={page === 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {Math.ceil(total / 50)}
      </span>
      <button disabled={page * 50 >= total} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
