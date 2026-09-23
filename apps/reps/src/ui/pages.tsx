import { useEffect, useState } from "react";
import {
  ArrowRight,
  Phone,
  Target,
  Trophy,
  Calendar,
  Wallet,
  Check,
  BookOpen,
  Flame,
  Play,
  Pause,
} from "lucide-react";
import {
  api,
  useApp,
  useData,
  State,
  Heading,
  Card,
  Form,
  Modal,
  Badge,
  Listing,
  Table,
  LinkButton,
  type Field,
} from "./lib";
import {
  money,
  label,
  OUTCOMES,
  callingWindow,
  localParts,
  type Row,
} from "../shared/core";
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function Dashboard() {
  const app = useApp(),
    state = useData("/report?kind=dashboard"),
    board = useData("/report?kind=leaderboard");
  const d = state.data || {},
    xp = Math.max(0, d.xp || 0),
    level = 1 + Math.floor(xp / 250);
  return (
    <>
      <Heading
        title={`Hello, ${app.ctx.rep?.name.split(" ")[0] || "there"}.`}
        description="A clear view of today. One good conversation at a time."
      />
      <State {...state}>
        <div className="stats">
          {[
            [Phone, "Calls today", d.calls_today || 0],
            [Target, "Verified sales", d.sales || 0],
            [Wallet, "Commission recorded", money(d.earned)],
            [Calendar, "Follow-ups due", d.followups || 0],
          ].map(([Icon, title, value]: any) => (
            <Card key={title}>
              <div className="stat-label">
                <span>{title}</span>
                <Icon size={19} />
              </div>
              <div className="stat-value">{value}</div>
            </Card>
          ))}
        </div>
        <div className="dashboard-grid">
          <section className="focus-hero">
            <span className="eyebrow">YOUR NEXT MOVE</span>
            <h2>
              Make room for
              <br />
              your next conversation.
            </h2>
            <p>
              {d.leads || 0} assigned leads. A focused queue, your scripts,
              <br />
              and every next step in one place.
            </p>
            <button
              className="primary"
              onClick={() =>
                app.navigate(
                  app.ctx.rep?.status === "active" ? "/focus" : "/onboarding",
                )
              }
            >
              {app.ctx.rep?.status === "active"
                ? "Start a focus session"
                : "Continue onboarding"}{" "}
              <ArrowRight size={18} />
            </button>
            <div className="hero-mark">
              <Target />
            </div>
          </section>
          <Card title="Your progression" extra={<Trophy size={20} />}>
            <div
              className={
                "profile-medallion level-" + Math.min(3, Math.floor(level / 10))
              }
            >
              {app.ctx.rep?.name.slice(0, 1) || "P"}
            </div>
            <h3 className="center">Level {level}</h3>
            <p className="center muted">{xp.toLocaleString()} career XP</p>
            <progress value={xp % 250} max={250} />
            <p className="fine-print">
              {250 - (xp % 250)} XP to the next level
            </p>
            <Streak
              activity={d.activity || []}
              timezone={app.ctx.rep?.timezone || "UTC"}
            />
          </Card>
          <Card title="Next steps" extra={<Calendar size={20} />}>
            <div className="next-step">
              <div className="mini-icon">
                <Calendar />
              </div>
              <div>
                <h3>{d.followups || 0} follow-ups are due</h3>
                <p>Keep the commitments you made.</p>
              </div>
              <LinkButton to="/followups">Open</LinkButton>
            </div>
            <div className="next-step">
              <div className="mini-icon">
                <BookOpen />
              </div>
              <div>
                <h3>Make your next call better</h3>
                <p>Review an opener or sharpen an objection response.</p>
              </div>
              <LinkButton to="/academy">Learn</LinkButton>
            </div>
          </Card>
          <Card
            title="Team leaderboard"
            extra={<LinkButton to="/leaderboard">View all</LinkButton>}
          >
            <State {...board} empty={!board.data?.length}>
              {board.data?.slice(0, 4).map((r: Row) => (
                <div className="leader-row" key={r.id}>
                  <span className="rank">{r.rank}</span>
                  <span className="avatar">{r.name[0]}</span>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{r.code}</small>
                  </div>
                  <strong>
                    {r.sales}
                    <small> sales</small>
                  </strong>
                </div>
              ))}
            </State>
          </Card>
        </div>
      </State>
    </>
  );
}
function Streak({ activity, timezone }: { activity: Row[]; timezone: string }) {
  const active = new Set(
    activity.filter((a) => a.xp >= 30).map((a) => String(a.day).slice(0, 10)),
  );
  let streak = 0,
    ended = false;
  const today = localParts(new Date(), timezone);
  const calendarDate = Date.parse(
    `${today.year}-${today.month}-${today.day}T12:00:00Z`,
  );
  const days: Row[] = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(calendarDate - i * 86400000),
      key = d.toISOString().slice(0, 10);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      d.getUTCDay()
    ];
    const eligible = !["Sat", "Sun"].includes(weekday);
    if (i < 7)
      days.unshift({ day: weekday[0], active: active.has(key), eligible });
    if (!eligible || ended) continue;
    if (active.has(key)) {
      streak++;
    } else if (i !== 0) ended = true;
  }
  return (
    <>
      <div className="streak-title">
        <Flame size={17} />
        {streak} workday streak
      </div>
      <div className="streak">
        {days.map((d, i) => (
          <span
            className={d.active ? "done" : !d.eligible ? "rest" : ""}
            key={i}
          >
            {d.day}
          </span>
        ))}
      </div>
      <small className="muted">
        30 earned XP on a workday keeps your streak going.
      </small>
    </>
  );
}
export function Leads() {
  const { mutate, navigate, run } = useApp();
  return (
    <>
      <Heading
        title="Your leads"
        description="The right context for your next conversation."
      >
        <button
          className="primary"
          onClick={() => run(() => mutate("claim", { count: 5 }))}
        >
          Get 5 leads
        </button>
      </Heading>
      <Listing
        name="businesses"
        query="&own=true"
        columns={[
          ["name", "Business"],
          ["phone", "Phone"],
          ["city", "City"],
          ["stage", "Stage"],
          ["expires_at", "Assigned until"],
        ]}
        actions={(r) => (
          <button onClick={() => navigate("/focus?business=" + r.id)}>
            Open business <ArrowRight size={15} />
          </button>
        )}
      />
    </>
  );
}
export function FollowupDialog({
  lead,
  onClose,
}: {
  lead: Row;
  onClose: () => void;
}) {
  const app = useApp();
  return (
    <Modal title={"Schedule follow-up · " + lead.name} onClose={onClose}>
      <p>
        Enter the time in your device timezone, <strong>{zone()}</strong>. The
        prospect is in <strong>{lead.timezone}</strong>.
      </p>
      <Form
        fields={[
          {
            name: "due_at",
            label: "Date and time",
            type: "datetime-local",
            required: true,
          },
          {
            name: "note",
            label: "Next step",
            type: "textarea",
            required: true,
          },
        ]}
        submit="Schedule follow-up"
        onSubmit={async (p) => {
          await app.mutate("followup", {
            ...p,
            due_at: new Date(p.due_at).toISOString(),
            timezone: lead.timezone,
            business_id: lead.id,
          });
          onClose();
        }}
      />
    </Modal>
  );
}
export function DealDialog({
  lead,
  onClose,
}: {
  lead: Row;
  onClose: () => void;
}) {
  const app = useApp(),
    packages = useData("/table?name=packages");
  return (
    <Modal title={"Create deal · " + lead.name} onClose={onClose}>
      <p>Pricing and commissions come from the saved package version.</p>
      <State {...packages}>
        <Form
          fields={
            [
              {
                name: "package_id",
                label: "Package",
                required: true,
                options: packages.data?.rows
                  .filter((x: Row) => x.active)
                  .map((p: Row) => ({
                    value: p.id,
                    label: `${p.name} · ${money(p.price_cents)} · ${money(p.commission_cents)} commission`,
                  })),
              },
              {
                name: "customer_email",
                label: "Customer email",
                type: "email",
                required: true,
              },
              ...(app.has("sales_admin")
                ? [
                    {
                      name: "price_cents",
                      label: "Approved Advanced price (cents)",
                      type: "number",
                      hint: "Leave blank to use standard pricing.",
                    },
                    {
                      name: "reason",
                      label: "Custom pricing approval reason",
                      type: "textarea",
                    },
                  ]
                : []),
            ] as Field[]
          }
          initial={{ customer_email: lead.email }}
          submit="Create deal"
          onSubmit={async (p) => {
            if (!p.price_cents) delete p.price_cents;
            await app.mutate("deal", { ...p, business_id: lead.id });
            onClose();
            app.navigate("/pipeline");
          }}
        />
      </State>
    </Modal>
  );
}
export function Focus() {
  const app = useApp(),
    selected = new URLSearchParams(location.search).get("business"),
    state = useData(
      "/table?name=businesses&own=true" + (selected ? "&id=" + selected : ""),
    ),
    scripts = useData("/table?name=content&kind=script");
  const [index, setIndex] = useState(0),
    [script, setScript] = useState(""),
    [outcome, setOutcome] = useState("no_answer"),
    [notes, setNotes] = useState(""),
    [dialog, setDialog] = useState(""),
    [paused, setPaused] = useState(false),
    [saved, setSaved] = useState(0),
    [requestId, setRequestId] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false);
  const leads =
      state.data?.rows.filter(
        (x: Row) => !x.dnc && !x.customer && !x.archived && x.stage !== "lost",
      ) || [],
    lead = leads[Math.min(index, Math.max(0, leads.length - 1))],
    scriptRows = scripts.data?.rows.filter((x: Row) => x.active) || [],
    selectedScript =
      scriptRows.find((x: Row) => x.id === script) || scriptRows[0];
  const window = lead
    ? callingWindow(
        lead.timezone,
        app.ctx.settings.calling_enabled,
        new Date(),
        app.ctx.settings.call_start,
        app.ctx.settings.call_end,
      )
    : { allowed: false, reason: "" };
  const next = () => {
    setIndex((i) => (i + 1) % Math.max(1, leads.length));
    setNotes("");
    setOutcome("no_answer");
    setRequestId(crypto.randomUUID());
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        ) ||
        dialog
      )
        return;
      if (e.key.toLowerCase() === "n") next();
      if (e.key.toLowerCase() === "f") setDialog("followup");
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [leads.length, dialog]);
  return (
    <>
      <Heading
        eyebrow="FOCUS MODE"
        title="One conversation at a time."
        description="Manual calling · Log accurate outcomes and clear next steps."
      >
        <span className="badge">{saved} logged this session</span>
        <button onClick={() => setPaused(!paused)}>
          {paused ? <Play size={16} /> : <Pause size={16} />}{" "}
          {paused ? "Resume" : "Pause"}
        </button>
      </Heading>
      <State {...state} empty={!lead}>
        {lead && (
          <div className="focus-grid">
            <Card>
              <div className="card-head">
                <span className="eyebrow">{lead.code}</span>
                <Badge value={lead.stage} />
              </div>
              <h2 className="business-name">{lead.name}</h2>
              <p>
                {[lead.industry, lead.city, lead.state]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <a
                className={
                  "call-number " + (!window.allowed || paused ? "disabled" : "")
                }
                href={
                  window.allowed && !paused ? "tel:" + lead.phone : undefined
                }
              >
                {lead.phone}
              </a>
              <div className={"notice " + (window.allowed ? "success" : "")}>
                {window.reason}
              </div>
              <div className="detail-grid">
                <div>
                  <small>Contact</small>
                  <strong>{lead.contact || "Not provided"}</strong>
                </div>
                <div>
                  <small>Website</small>
                  {lead.domain ? (
                    <a
                      href={"https://" + lead.domain}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {lead.domain}
                    </a>
                  ) : (
                    <strong>Not provided</strong>
                  )}
                </div>
              </div>
              {lead.notes && <p className="prose">{lead.notes}</p>}
              <div className="actions">
                <button onClick={() => setDialog("followup")}>
                  <Calendar size={16} /> Follow-up
                </button>
                <button onClick={() => setDialog("deal")}>Create deal</button>
              </div>
              <div className="divider" />
              <h3>Log the outcome</h3>
              <div className="outcomes">
                {OUTCOMES.map((o) => (
                  <button
                    className={outcome === o ? "selected" : ""}
                    key={o}
                    onClick={() => setOutcome(o)}
                  >
                    {label(o)}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Conversation notes</span>
                <textarea
                  rows={4}
                  maxLength={5000}
                  placeholder="What mattered? What happens next?"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || paused}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await app.mutate("call", {
                        business_id: lead.id,
                        request_id: requestId,
                        outcome,
                        notes,
                        script_id: selectedScript?.id,
                      });
                      setSaved((n) => n + 1);
                      setRequestId(crypto.randomUUID());
                      setNotes("");
                      if (["follow_up", "meeting"].includes(outcome))
                        setDialog("followup");
                      else next();
                    } catch (e) {
                      app.notify((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save outcome <Check size={16} />
                </button>
                <button onClick={next}>
                  Next business <ArrowRight size={16} />
                </button>
              </div>
              <small className="muted">
                Shortcuts: N next business · F follow-up. “Sale reported” awaits
                verified payment.
              </small>
            </Card>
            <div>
              <Card title="Conversation guide" extra={<BookOpen size={18} />}>
                <div className="script-tabs">
                  {scriptRows.map((s: Row) => (
                    <button
                      className={s.id === selectedScript?.id ? "selected" : ""}
                      onClick={() => setScript(s.id)}
                      key={s.id}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                <h3>{selectedScript?.title}</h3>
                <div className="script-copy">
                  {selectedScript?.body
                    ?.replaceAll("[business name]", lead.name)
                    .replaceAll("[your name]", app.ctx.rep.name)
                    .replaceAll("\\n", "\n")}
                </div>
                <div className="notice">
                  Listen first. Use the script to guide a natural conversation.
                </div>
              </Card>
              <Card title="Recent activity">
                <Activity business={lead.id} />
              </Card>
            </div>
          </div>
        )}
      </State>
      {dialog === "followup" && lead && (
        <FollowupDialog lead={lead} onClose={() => setDialog("")} />
      )}{" "}
      {dialog === "deal" && lead && (
        <DealDialog lead={lead} onClose={() => setDialog("")} />
      )}
    </>
  );
}
function Activity({ business }: { business: string }) {
  const state = useData("/table?name=calls&business=" + business);
  return (
    <State {...state} empty={!state.data?.rows.length}>
      {state.data?.rows.slice(0, 5).map((r: Row) => (
        <div className="activity" key={r.id}>
          <Badge value={r.outcome} />
          <p>{r.notes || "No additional notes."}</p>
          <small>{new Date(r.created_at).toLocaleString()}</small>
        </div>
      ))}
    </State>
  );
}
export function Followups() {
  const app = useApp();
  return (
    <>
      <Heading
        title="Follow-ups"
        description="Keep every commitment. Times below use your device timezone."
      />
      <Listing
        name="followups"
        query="&own=true&status=open"
        columns={[
          ["due_at", "Due"],
          ["timezone", "Prospect timezone"],
          ["note", "Next step"],
          ["status", "Status"],
        ]}
        actions={(r) => (
          <>
            <button
              onClick={() => app.navigate("/focus?business=" + r.business_id)}
            >
              Open business
            </button>
            <button
              onClick={() =>
                app.run(() => app.mutate("followup_complete", { id: r.id }))
              }
            >
              Complete
            </button>
          </>
        )}
      />
    </>
  );
}
export function Pipeline() {
  const app = useApp();
  return (
    <>
      <Heading
        title="Your pipeline"
        description="Every opportunity has a clear next step."
      />
      <Listing
        name="deals"
        query="&own=true"
        columns={[
          ["code", "Deal"],
          ["package_name", "Package"],
          ["price_cents", "Sale"],
          ["commission_cents", "Commission snapshot"],
          ["stage", "Stage"],
        ]}
        actions={(r) => (
          <>
            {r.stage !== "paid" && r.stage !== "cancelled" && (
              <button
                onClick={() =>
                  app.run(async () => {
                    const result = await api("/checkout", { id: r.id });
                    app.setLink(result.url);
                    app.refresh();
                  })
                }
              >
                Create / view checkout
              </button>
            )}
            <button
              onClick={() => app.navigate("/focus?business=" + r.business_id)}
            >
              Business
            </button>
          </>
        )}
      />
    </>
  );
}
export function Money() {
  const totals = useData("/report?kind=dashboard");
  return (
    <>
      <Heading
        title="My money"
        description="Your commissions, Connect transfers, and bank payouts—each tracked separately."
      />
      <div className="stats two">
        <Card>
          <div className="stat-label">Recorded commission</div>
          <div className="stat-value">{money(totals.data?.earned)}</div>
        </Card>
        <Card>
          <div className="stat-label">Net transferred to Connect</div>
          <div className="stat-value">{money(totals.data?.transferred)}</div>
        </Card>
      </div>
      <div className="notice">
        Transfers move commission to your connected account. Your bank payout
        status appears separately below. Holds, refunds, and disputes can affect
        availability.
      </div>
      <h2>Commission ledger</h2>
      <Listing
        name="commissions"
        query="&own=true"
        columns={[
          ["amount_cents", "Amount"],
          ["status", "Status"],
          ["hold_until", "Hold until"],
          ["reversed_cents", "Reversed"],
          ["transfer_id", "Connect transfer"],
        ]}
      />
      <h2>Bank payouts</h2>
      <Listing
        name="payouts"
        query="&own=true"
        columns={[
          ["amount_cents", "Amount"],
          ["currency", "Currency"],
          ["status", "Status"],
          ["arrival_at", "Estimated arrival"],
        ]}
      />
    </>
  );
}
export function Academy() {
  const state = useData("/table?name=content"),
    training = useData("/table?name=training&own=true"),
    app = useApp(),
    [item, setItem] = useState<Row | null>(null),
    [result, setResult] = useState<Row | null>(null);
  return (
    <>
      <Heading
        title="Pixelalty Academy"
        description="Practical skills for your next conversation."
      />
      <State {...state}>
        <div className="lesson-grid">
          {state.data?.rows
            .filter(
              (r: Row) =>
                r.active &&
                ["lesson", "quiz", "knowledge", "announcement"].includes(
                  r.kind,
                ),
            )
            .map((r: Row) => (
              <Card key={r.id}>
                <span className="eyebrow">
                  {label(r.kind)} · VERSION {r.version}
                </span>
                <h3>{r.title}</h3>
                <p>
                  {r.kind === "quiz"
                    ? "Check your understanding before working with prospects."
                    : r.body.slice(0, 125) + "…"}
                </p>
                <button
                  onClick={() => {
                    setItem(r);
                    setResult(null);
                  }}
                >
                  {training.data?.rows.some(
                    (x: Row) => x.content_id === r.id && x.passed,
                  )
                    ? "Review completed lesson"
                    : "Open"}{" "}
                  <ArrowRight size={15} />
                </button>
              </Card>
            ))}
        </div>
      </State>
      {item && (
        <Modal title={item.title} onClose={() => setItem(null)}>
          {item.kind === "quiz" ? (
            result ? (
              <div className="notice">
                Score: {result.score}% ·{" "}
                {result.passed ? "Passed" : "Review the lessons and try again."}
              </div>
            ) : (
              <Form
                fields={JSON.parse(item.body).map((q: Row, i: number) => ({
                  name: "q" + i,
                  label: q.question,
                  required: true,
                  options: q.options.map((o: string, j: number) => ({
                    label: o,
                    value: String(j),
                  })),
                }))}
                submit="Submit answers"
                onSubmit={async (p) => {
                  const r = await api("/action", {
                    action: "quiz",
                    p: {
                      content_id: item.id,
                      answers: Object.keys(p)
                        .sort()
                        .map((k) => Number(p[k])),
                    },
                  });
                  setResult(r);
                  app.refresh();
                }}
              />
            )
          ) : (
            <>
              <div className="prose">{item.body}</div>
              {item.kind === "lesson" && (
                <button
                  className="primary"
                  onClick={() =>
                    app.run(async () => {
                      await app.mutate("lesson", { content_id: item.id });
                      setItem(null);
                    })
                  }
                >
                  Mark complete <Check size={16} />
                </button>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function Onboarding() {
  const app = useApp(),
    privateData = useData("/table?name=rep_private&own=true"),
    connect = useData("/table?name=connect&own=true"),
    agreements = useData("/table?name=content&kind=agreement"),
    accepted = useData("/table?name=agreements&own=true"),
    [item, setItem] = useState<Row | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("connect")) {
      app.run(async () => {
        await api("/connect", { refresh: true });
        app.refresh();
        history.replaceState({}, "", location.pathname);
      });
    }
  }, []);
  const p = privateData.data?.rows[0],
    c = connect.data?.rows[0];
  return (
    <>
      <Heading
        title="Welcome to Pixelalty."
        description="Complete these steps so an administrator can activate your account."
      />
      <div className="onboarding-grid">
        <Card title="01 · Your profile">
          <p>Set your name and timezone, then choose a secure password.</p>
          <LinkButton to="/profile">Complete profile</LinkButton>
        </Card>
        <Card title="02 · Required agreement">
          <State
            {...agreements}
            empty={!agreements.data?.rows.some((r: Row) => r.active)}
          >
            {agreements.data?.rows
              .filter((r: Row) => r.active)
              .map((r: Row) => (
                <div key={r.id}>
                  <h3>{r.title}</h3>
                  <p>
                    Version {r.version} ·{" "}
                    {accepted.data?.rows.some((a: Row) => a.content_id === r.id)
                      ? "Accepted"
                      : "Awaiting your acceptance"}
                  </p>
                  <button onClick={() => setItem(r)}>Read agreement</button>
                </div>
              ))}
          </State>
          <small className="muted">
            Your administrator publishes the agreement that applies to your
            work.
          </small>
        </Card>
        <Card title="03 · Classification & tax">
          <p>
            Classification:{" "}
            <strong>{label(p?.classification || "unconfigured")}</strong>
          </p>
          <p>
            Tax verification: <Badge value={p?.tax_status || "pending"} />
          </p>
          <small className="muted">
            Complete the approved external verification process with your
            administrator. Do not send tax IDs or bank details through support.
          </small>
        </Card>
        <Card title="04 · Payment setup">
          <p>
            {c?.payouts_enabled && c?.transfers_enabled
              ? "Your connected account is ready."
              : p?.classification === "employee"
                ? "Your administrator will verify your payroll setup."
                : "Complete hosted payment setup to receive eligible commissions."}
          </p>
          <button
            disabled={p?.classification !== "contractor"}
            onClick={() =>
              app.run(async () => {
                const r = await api("/connect", {});
                location.assign(r.url);
              })
            }
          >
            Open secure payment setup
          </button>
        </Card>
        <Card title="05 · Academy & quiz">
          <p>
            Learn the packages, calling standards, CRM workflow, and customer
            expectations.
          </p>
          <LinkButton to="/academy">Open Academy</LinkButton>
        </Card>
        <Card title="06 · Activation">
          <Badge value={app.ctx.rep?.status || "onboarding"} />
          <p>
            An administrator activates your account after all requirements are
            complete.
          </p>
          <LinkButton to="/support">Ask for help</LinkButton>
        </Card>
      </div>
      {item && (
        <Modal title={item.title} onClose={() => setItem(null)}>
          <div className="prose agreement">{item.body}</div>
          <Form
            fields={[
              {
                name: "signature",
                label: "Your full legal name",
                required: true,
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
        </Modal>
      )}
    </>
  );
}
export function Profile() {
  const app = useApp(),
    rep = app.ctx.rep;
  return (
    <>
      <Heading
        title="Your profile"
        description="Keep your workspace personal and your information current."
      />
      <div className="onboarding-grid">
        <Card title="Profile details">
          <Form
            initial={rep || {}}
            fields={[
              { name: "name", label: "Display name", required: true },
              { name: "timezone", label: "Timezone", required: true },
              { name: "bio", label: "About you", type: "textarea" },
              {
                name: "income_goal",
                label: "Monthly income goal (cents)",
                type: "number",
                min: 0,
                hint: "A personal planning goal, not a guarantee of earnings.",
              },
            ]}
            submit="Save profile"
            onSubmit={(p) => app.mutate("profile", p)}
          />
        </Card>
        <Card title="Password & appearance">
          <Form
            fields={[
              {
                name: "password",
                label: "New password",
                type: "password",
                required: true,
              },
            ]}
            submit="Update password"
            onSubmit={async (p) => {
              if (p.password.length < 12)
                throw Error("Use at least 12 characters.");
              const r = await app.client.auth.updateUser({
                password: p.password,
              });
              if (r.error) throw r.error;
              app.notify("Password updated.");
            }}
          />
          <div className="divider" />
          <label className="field">
            <span>Appearance</span>
            <select
              value={app.theme}
              onChange={(e) => app.setTheme(e.target.value)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </Card>
      </div>
    </>
  );
}
export function Leaderboard() {
  const state = useData("/report?kind=leaderboard");
  return (
    <>
      <Heading
        title="A little healthy momentum."
        eyebrow="TEAM LEADERBOARD"
        description="Verified sales lead the way. Career XP breaks ties. Personal earnings stay private."
      />
      <Card>
        <State {...state}>
          <Table
            rows={state.data || []}
            columns={[
              ["rank", "Rank"],
              ["name", "Rep"],
              ["code", "Rep ID"],
              ["sales", "Verified sales"],
              ["xp", "Career XP"],
              ["calls", "Calls"],
            ]}
          />
        </State>
      </Card>
    </>
  );
}
export function Support() {
  const app = useApp();
  return (
    <>
      <Heading
        title="How can we help?"
        description="Ask about your account, leads, onboarding, or payment status."
      />
      <Card title="Open a support ticket">
        <Form
          fields={[
            { name: "subject", label: "Subject", required: true },
            {
              name: "body",
              label: "How can we help?",
              type: "textarea",
              required: true,
            },
          ]}
          submit="Send ticket"
          onSubmit={(p) => app.mutate("support", p)}
        />
      </Card>
      <h2>Your tickets</h2>
      <Listing
        name="support"
        query="&own=true"
        columns={[
          ["subject", "Subject"],
          ["status", "Status"],
          ["reply", "Latest response"],
          ["created_at", "Opened"],
        ]}
      />
    </>
  );
}
