import { useState } from "react";
import { Star, ArrowRight } from "lucide-react";
import {
  useApp,
  useData,
  Modal,
  State,
  Card,
  Form,
  Listing,
  Badge,
  ActionDialog,
} from "./lib";
import { label, type Row } from "../shared/core";

export function BusinessDetails({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const app = useApp(),
    state = useData(`/report?kind=business&id=${id}`),
    notes = useData(`/table?name=notes&business=${id}`),
    favorites = useData(`/table?name=favorites&business=${id}`);
  const [edit, setEdit] = useState(false),
    [revision, setRevision] = useState<Row | null>(null);
  const lead = state.data?.business;
  return (
    <Modal title={lead?.name || "Business details"} onClose={onClose}>
      <State {...state}>
        {lead && (
          <>
            <div className="card-head">
              <span className="eyebrow">{lead.code}</span>
              <Badge value={lead.stage} />
            </div>
            <div className="detail-grid">
              {[
                "phone",
                "email",
                "contact",
                "domain",
                "city",
                "state",
                "industry",
                "timezone",
                "source",
              ].map((k) => (
                <div key={k}>
                  <small>{label(k)}</small>
                  <strong>{lead[k] || "Not provided"}</strong>
                </div>
              ))}
            </div>
            {lead.tags?.length > 0 && <p>Tags: {lead.tags.join(", ")}</p>}
            {lead.metadata && Object.values(lead.metadata).some(Boolean) && (
              <Card title="Business context">
                <div className="detail-grid">
                  {Object.entries(lead.metadata)
                    .filter(([, v]) => v !== null && v !== "")
                    .map(([k, v]) => (
                      <div key={k}>
                        <small>{label(k)}</small>
                        <strong>{String(v)}</strong>
                      </div>
                    ))}
                </div>
              </Card>
            )}
            {lead.notes && (
              <Card title="Imported notes">
                <p className="prose">{lead.notes}</p>
              </Card>
            )}
            <div className="actions">
              {app.ctx.rep?.id === lead.owner_id && (
                <>
                  <button
                    onClick={() =>
                      app.run(async () => {
                        await app.mutate("favorite", {
                          business_id: id,
                          enabled: !favorites.data?.rows.length,
                        });
                      })
                    }
                  >
                    <Star size={16} />
                    {favorites.data?.rows.length
                      ? "Remove favorite"
                      : "Favorite"}
                  </button>
                  {!lead.customer && !lead.dnc && (
                    <button
                      className="primary"
                      onClick={() => {
                        onClose();
                        app.navigate(`/focus?business=${id}`);
                      }}
                    >
                      Open in calling queue <ArrowRight size={16} />
                    </button>
                  )}
                </>
              )}
              {app.has("sales_admin") && (
                <button onClick={() => setEdit(true)}>
                  Edit business details
                </button>
              )}
            </div>
            {!lead.customer && !lead.dnc && !lead.archived && (
              <Form
                key={lead.stage}
                initial={{ stage: lead.stage }}
                fields={[
                  {
                    name: "stage",
                    label: "Pipeline stage",
                    required: true,
                    options: [
                      "new",
                      "working",
                      "interested",
                      "follow_up",
                      "meeting",
                      "proposal",
                      "lost",
                    ].map((value) => ({ value, label: label(value) })),
                  },
                ]}
                submit="Update stage"
                onSubmit={(p) =>
                  app.mutate("lead_stage", { ...p, business_id: id })
                }
              />
            )}
            <h3>Notes</h3>
            <State
              {...notes}
              empty={!notes.data?.rows.length}
              emptyText="Add context to make the next conversation useful."
            >
              {notes.data?.rows
                .filter(
                  (r: Row) =>
                    !notes.data.rows.some(
                      (other: Row) => other.supersedes_id === r.id,
                    ),
                )
                .map((r: Row) => (
                  <article className="activity" key={r.id}>
                    <p className="prose">{r.body}</p>
                    <small>
                      {label(r.visibility)} ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                      {r.supersedes_id
                        ? " · Revised; prior version retained"
                        : ""}
                    </small>
                    {r.author_id === app.ctx.user_id && (
                      <button onClick={() => setRevision(r)}>
                        Revise note
                      </button>
                    )}
                  </article>
                ))}
            </State>
            <Form
              key={revision?.id || "new"}
              fields={[
                {
                  name: "body",
                  label: revision ? "Revised note" : "Add a note",
                  type: "textarea",
                  required: true,
                  maxLength: 5000,
                },
                {
                  name: "visibility",
                  label: "Visibility",
                  required: true,
                  options: [
                    {
                      value: "team",
                      label: "Assigned rep and authorized team",
                    },
                    {
                      value: "private",
                      label: "Only me and authorized administrators",
                    },
                  ],
                },
              ]}
              initial={{
                body: revision?.body || "",
                visibility: revision?.visibility || "team",
              }}
              submit={revision ? "Save new note version" : "Save note"}
              onSubmit={async (p) => {
                await app.mutate("note", {
                  ...p,
                  business_id: id,
                  ...(revision ? { supersedes_id: revision.id } : {}),
                });
                setRevision(null);
              }}
            />
            {notes.data?.rows.some((r: Row) => r.supersedes_id) && (
              <details className="activity">
                <summary>Note revision history</summary>
                {notes.data.rows.map((r: Row) => (
                  <div className="activity" key={r.id}>
                    <p>{r.body}</p>
                    <small>
                      {new Date(r.created_at).toLocaleString()} ·{" "}
                      {r.supersedes_id ? "Revision" : "Original"}
                    </small>
                  </div>
                ))}
              </details>
            )}
            <h3>Business timeline</h3>
            <div className="timeline">
              {state.data.timeline.map((r: Row, i: number) => (
                <article className="activity" key={i}>
                  <strong>{label(r.title)}</strong>
                  <p>{r.detail}</p>
                  <time>{new Date(r.created_at).toLocaleString()}</time>
                </article>
              ))}
              {!state.data.timeline.length && (
                <p className="muted">
                  Assignments, calls, follow-ups and deals will appear here.
                </p>
              )}
            </div>
          </>
        )}
      </State>
      {edit && (
        <ActionDialog
          title="Save business details"
          action="business_edit"
          initial={lead}
          fields={[
            { name: "name", label: "Business name", required: true },
            { name: "contact", label: "Decision-maker name" },
            { name: "email", label: "Business email", type: "email" },
            { name: "timezone", label: "Prospect timezone", required: true },
            { name: "city", label: "City" },
            { name: "state", label: "State" },
            { name: "industry", label: "Industry" },
            { name: "source", label: "Lead source" },
          ]}
          onClose={() => setEdit(false)}
        />
      )}
    </Modal>
  );
}

export function RepDetails({
  rep,
  onClose,
}: {
  rep: Row;
  onClose: () => void;
}) {
  const state = useData(`/report?kind=onboarding&id=${rep.id}`),
    app = useApp();
  return (
    <Modal title={`${rep.name} · ${rep.code}`} onClose={onClose}>
      <State {...state}>
        <Badge value={rep.status} />
        <h3>Onboarding requirements</h3>
        <div className="checklist">
          {state.data?.steps.map((s: Row) => (
            <div className="health-row" key={s.key}>
              <span>{s.title}</span>
              <strong>
                {s.complete ? "Complete" : s.required ? "Required" : "Optional"}
              </strong>
            </div>
          ))}
        </div>
        <p className="notice">
          {state.data?.ready
            ? "Required steps are complete. This rep is ready for administrator activation."
            : "Complete the outstanding requirements before activation."}
        </p>
        <h3>Training history</h3>
        <Listing
          name="training"
          query={`&rep=${rep.id}`}
          columns={[
            ["created_at", "Completed"],
            ["score", "Quiz score"],
            ["passed", "Passed"],
          ]}
        />
        <h3>Assigned businesses</h3>
        <Listing
          name="businesses"
          query={`&owner=${rep.id}`}
          columns={[
            ["name", "Business"],
            ["stage", "Stage"],
            ["expires_at", "Ownership expires"],
          ]}
        />
        {app.has("finance_admin") && (
          <>
            <h3>Commission records</h3>
            <Listing
              name="commissions"
              query={`&rep=${rep.id}`}
              columns={[
                ["deal_code", "Deal"],
                ["amount_cents", "Commission"],
                ["status", "Status"],
              ]}
            />
          </>
        )}
      </State>
    </Modal>
  );
}

export function OnboardingProgress({ id }: { id?: string }) {
  const state = useData(`/report?kind=onboarding${id ? `&id=${id}` : ""}`),
    app = useApp();
  const steps = state.data?.steps || [],
    done = steps.filter((s: Row) => s.complete || !s.required).length;
  return (
    <Card title="Your onboarding checklist">
      <State {...state}>
        <p>
          <strong>
            {done} of {steps.length}
          </strong>{" "}
          steps complete
        </p>
        <progress
          aria-label="Onboarding progress"
          value={done}
          max={steps.length || 10}
        />
        <div className="onboarding-checklist">
          {steps.map((s: Row) => (
            <button
              className={s.complete ? "checklist-step done" : "checklist-step"}
              key={s.key}
              onClick={() => app.navigate(s.link)}
            >
              <span aria-hidden="true">{s.complete ? "✓" : "○"}</span>
              <span>
                {s.title}
                <small>
                  {s.complete
                    ? "Complete"
                    : s.required
                      ? "Required"
                      : "Optional"}
                </small>
              </span>
            </button>
          ))}
        </div>
      </State>
    </Card>
  );
}
