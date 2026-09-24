import { useEffect, useState } from "react";
import { authErrorMessage } from "../shared/auth";
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
import { money, label, type Row } from "../shared/core";
import { BusinessDetails, OnboardingProgress } from "./details";
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function Dashboard() {
  const app = useApp(),
    state = useData("/report?kind=dashboard"),
    board = useData("/report?kind=leaderboard");
  const d = state.data || {},
    xp = Math.max(0, d.xp || 0),
    step = d.level_step || 250,
    level = 1 + Math.floor(xp / step);
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
                "profile-medallion frame-" +
                (app.ctx.rep?.preferences?.frame === "basic"
                  ? "basic"
                  : level >= 50
                    ? "prestige"
                    : level >= 30
                      ? "elite"
                      : level >= 20
                        ? "metallic"
                        : level >= 10
                          ? "premium"
                          : level >= 5
                            ? "enhanced"
                            : "basic")
              }
            >
              {app.ctx.rep?.name.slice(0, 1) || "P"}
            </div>
            <h3 className="center">Level {level}</h3>
            <p className="center muted">{xp.toLocaleString()} career XP</p>
            <progress
              aria-label="Career level progress"
              value={xp % step}
              max={step}
            />
            <p className="fine-print">
              {step - (xp % step)} XP to the next level
            </p>
            <Streak summary={d.streak || {}} />
          </Card>
          <Card
            title="Your monthly goals"
            extra={<LinkButton to="/profile">Set goals</LinkButton>}
          >
            {[
              ["Income", app.ctx.rep?.income_goal, d.month_commission, true],
              [
                "Verified sales",
                app.ctx.rep?.preferences?.sales_goal,
                d.month_sales,
                false,
              ],
              [
                "Qualifying calls",
                app.ctx.rep?.preferences?.calls_goal,
                d.month_calls,
                false,
              ],
            ].map(([name, target, current, currency]: any) => (
              <div className="goal" key={name}>
                <div className="card-head">
                  <strong>{name}</strong>
                  <small>
                    {currency ? money(current || 0) : current || 0} /{" "}
                    {target
                      ? currency
                        ? money(target)
                        : target
                      : "No goal set"}
                  </small>
                </div>
                <progress
                  aria-label={name + " goal"}
                  value={Math.min(current || 0, target || 1)}
                  max={target || 1}
                />
              </div>
            ))}
            <p className="fine-print">
              Personal, optional goals. Recorded commission can remain on hold;
              future earnings are not guaranteed.
            </p>
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
function Streak({ summary: s }: { summary: Row }) {
  const app = useApp();
  return (
    <>
      <div className="streak-title">
        <Flame size={17} />
        {s.current || 0} workday streak
      </div>
      <div className="streak">
        {s.days?.map((d: Row) => (
          <span
            title={`${d.day}: ${d.calls} qualifying calls${d.protected ? " · Protected day" : ""}`}
            className={d.complete ? "done" : d.protected ? "rest" : ""}
            key={d.day}
          >
            {new Date(d.day + "T12:00:00Z").toLocaleDateString(undefined, {
              weekday: "narrow",
            })}
          </span>
        ))}
      </div>
      <small className="muted">
        Optional challenge: {s.today || 0} / {s.target || 30} qualifying calls
        today. Weekends are protected. Longest: {s.longest || 0} workdays.
      </small>
      {s.freezes_left > 0 && (
        <button
          className="text-button"
          onClick={() =>
            app.run(() =>
              app.mutate("streak_freeze", { day: s.days?.at(-1)?.day }),
            )
          }
        >
          Protect today · {s.freezes_left} freezes available
        </button>
      )}
    </>
  );
}
export function Leads() {
  const { mutate, run, notify, ctx } = useApp();
  const [detail, setDetail] = useState<string | null>(
      new URLSearchParams(location.search).get("business"),
    ),
    [favorites, setFavorites] = useState(false),
    [view, setView] = useState("all");
  return (
    <>
      <Heading
        title="Your leads"
        description="The right context for your next conversation."
      >
        <select
          aria-label="Lead view"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          {[
            ["all", "All assigned leads"],
            ["due", "Due today"],
            ["hot", "Hot opportunities"],
            ["no_answer", "No answer"],
            ["recycle", "Recycle"],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <button onClick={() => setFavorites(!favorites)}>
          {favorites ? "Show all leads" : "Favorites"}
        </button>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              const r = await mutate("claim", {
                count: ctx.settings.claim_count || 10,
              });
              notify(
                r.claimed
                  ? `${r.claimed} leads assigned to you.`
                  : "No leads were available within your capacity.",
              );
            })
          }
        >
          Get leads
        </button>
      </Heading>
      <Listing
        name="businesses"
        query={"&own=true&view=" + view + (favorites ? "&favorite=true" : "")}
        columns={[
          ["name", "Business"],
          ["phone", "Phone"],
          ["city", "City"],
          ["stage", "Stage"],
          ["expires_at", "Assigned until"],
        ]}
        actions={(r) => (
          <button onClick={() => setDetail(r.id)}>
            Open business <ArrowRight size={15} />
          </button>
        )}
      />
      {detail && (
        <BusinessDetails id={detail} onClose={() => setDetail(null)} />
      )}
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
          {
            name: "priority",
            label: "Priority",
            required: true,
            options: [
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
              { value: "low", label: "Low" },
            ],
          },
          {
            name: "channel",
            label: "Channel",
            required: true,
            options: [
              { value: "phone", label: "Phone" },
              { value: "email", label: "Email" },
              { value: "other", label: "Other" },
            ],
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
    packages = useData("/table?name=packages&active=true"),
    [quote, setQuote] = useState(false);
  return (
    <Modal title={"Create deal · " + lead.name} onClose={onClose}>
      <p>Pricing and commissions come from the saved package version.</p>
      <button onClick={() => setQuote(!quote)}>
        {quote ? "Use a published package" : "Request an Advanced quote"}
      </button>
      {quote ? (
        <Form
          fields={[
            {
              name: "customer_email",
              label: "Customer email",
              type: "email",
              required: true,
            },
            {
              name: "requirements",
              label: "Requested scope",
              type: "textarea",
              required: true,
              minLength: 10,
              maxLength: 5000,
            },
          ]}
          initial={{ customer_email: lead.email }}
          submit="Request quote"
          onSubmit={async (p) => {
            await app.mutate("quote_request", { ...p, business_id: lead.id });
            onClose();
            app.navigate("/pipeline");
          }}
        />
      ) : (
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
                        label: "Approved Advanced price ($)",
                        type: "currency",
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
      )}
    </Modal>
  );
}
export { Focus } from "./focus";
export function Followups() {
  const app = useApp(),
    [edit, setEdit] = useState<Row | null>(null),
    [due, setDue] = useState(false);
  return (
    <>
      <Heading
        title="Follow-ups"
        description="Keep every commitment. Times below use your device timezone."
      >
        <button onClick={() => setDue(!due)}>
          {due ? "All open follow-ups" : "Due & overdue"}
        </button>
      </Heading>
      <Listing
        name="followups"
        query={
          "&own=true&status=open&sort=due_at&direction=asc" +
          (due ? "&due=true" : "")
        }
        columns={[
          ["business_name", "Business"],
          ["due_at", "Due"],
          ["timezone", "Prospect timezone"],
          ["note", "Next step"],
          ["status", "Status"],
        ]}
        actions={(r) => (
          <>
            <button onClick={() => setEdit(r)}>Reschedule</button>
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
      {edit && (
        <Modal title="Reschedule follow-up" onClose={() => setEdit(null)}>
          <p>Enter the new time in your device timezone: {zone()}.</p>
          <Form
            initial={{
              note: edit.note,
              priority: edit.priority,
              channel: edit.channel,
            }}
            fields={[
              {
                name: "due_at",
                label: "New date and time",
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
            submit="Save follow-up"
            onSubmit={async (p) => {
              await app.mutate("followup_update", {
                ...p,
                id: edit.id,
                timezone: edit.timezone,
                due_at: new Date(p.due_at).toISOString(),
              });
              setEdit(null);
            }}
          />
          <button
            className="text-button"
            onClick={() =>
              app.run(async () => {
                await app.mutate("followup_cancel", { id: edit.id });
                setEdit(null);
              })
            }
          >
            Cancel this follow-up
          </button>
        </Modal>
      )}
    </>
  );
}
export { Pipeline } from "./pipeline";
export function Money() {
  const totals = useData("/report?kind=money");
  return (
    <>
      <Heading
        title="My money"
        description="Your commissions, Connect transfers, and bank payouts—each tracked separately."
      />
      <State {...totals}>
        <div className="stats">
          {[
            ["hold", "Held commission"],
            ["payable", "Payable"],
            ["queued", "Transfer queued"],
            ["transferred", "Net transferred to Connect"],
            ["bank_paid", "Confirmed bank payouts"],
            ["review", "Under review"],
          ].map(([k, t]) => (
            <Card key={k}>
              <div className="stat-label">{t}</div>
              <div className="stat-value">{money(totals.data?.[k])}</div>
            </Card>
          ))}
        </div>
      </State>
      <Card title="Your payout account">
        <p>
          {totals.data?.connect?.payouts_enabled
            ? "Bank payouts are enabled."
            : "Complete your payment setup or review the outstanding requirements."}
        </p>
        <LinkButton to="/onboarding">Manage payment setup</LinkButton>
      </Card>
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
          ["deal_code", "Deal"],
          ["package_name", "Package"],
          ["sale_cents", "Customer payment"],
          ["amount_cents", "Amount"],
          ["status", "Status"],
          ["hold_until", "Hold until"],
          ["reversed_cents", "Reversed"],
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
  const state = useData("/table?name=content&active=true"),
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
                      answers: JSON.parse(item.body).map((_q: Row, i: number) =>
                        Number(p["q" + i]),
                      ),
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
              {item.kind === "lesson" && app.ctx.rep && (
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
      <OnboardingProgress />
      <div className="onboarding-grid">
        <Card title="01 · Your profile">
          <p>Set your name and timezone, then choose a secure password.</p>
          <LinkButton to="/profile">Complete profile</LinkButton>
        </Card>
        <Card title="02 · Required agreement">
          <State
            {...agreements}
            empty={!agreements.data?.rows.some((r: Row) => r.active)}
            emptyText="Your administrator has not published the required agreement yet."
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
        {rep && (
          <Card title="Profile details">
            <Form
              initial={rep || {}}
              fields={[
                { name: "name", label: "Display name", required: true },
                { name: "timezone", label: "Timezone", required: true },
                { name: "bio", label: "About you", type: "textarea" },
                {
                  name: "income_goal",
                  label: "Monthly income goal ($)",
                  type: "currency",
                  min: 0,
                  hint: "A personal planning goal, not a guarantee of earnings.",
                },
              ]}
              submit="Save profile"
              onSubmit={(p) => app.mutate("profile", p)}
            />
          </Card>
        )}
        {rep && (
          <Card title="Goals & calling preferences">
            <Form
              initial={{ shortcuts: true, ...rep.preferences }}
              fields={[
                {
                  name: "sales_goal",
                  label: "Monthly verified sales goal",
                  type: "number",
                  min: 0,
                  max: 10000,
                },
                {
                  name: "calls_goal",
                  label: "Monthly qualifying call goal",
                  type: "number",
                  min: 0,
                  max: 100000,
                },
                {
                  name: "shortcuts",
                  label: "Enable focus keyboard shortcuts",
                  type: "checkbox",
                },
                {
                  name: "frame",
                  label: "Profile frame",
                  options: [
                    { value: "auto", label: "My current career level" },
                    { value: "basic", label: "Simple frame" },
                  ],
                },
              ]}
              submit="Save preferences"
              onSubmit={(p) => app.mutate("preferences", { value: p })}
            />
          </Card>
        )}
        <Card title="Password & account">
          <Form
            fields={[
              {
                name: "password",
                label: "New password",
                type: "password",
                minLength: 12,
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
              if (r.error) throw Error(authErrorMessage(r.error));
              app.notify("Password updated.");
            }}
          />
          <div className="divider" />
          <h3>Make this workspace yours</h3>
          <p>
            Choose your theme, accent color, text size, spacing and pinned
            pages.
          </p>
          <LinkButton to="/appearance">
            Customize appearance <ArrowRight size={16} />
          </LinkButton>
        </Card>
      </div>
    </>
  );
}
export function Leaderboard() {
  const [metric, setMetric] = useState("sales"),
    [period, setPeriod] = useState("month"),
    [page, setPage] = useState(0);
  const state = useData(
    `/report?kind=leaderboard&metric=${metric}&period=${period}&page=${page}`,
  );
  return (
    <>
      <Heading
        title="A little healthy momentum."
        eyebrow="TEAM LEADERBOARD"
        description="Verified sales and qualifying activity. Career XP breaks ties. Personal earnings stay private."
      />
      <Card>
        <div className="toolbar">
          <select
            aria-label="Leaderboard metric"
            value={metric}
            onChange={(e) => {
              setMetric(e.target.value);
              setPage(0);
            }}
          >
            {["sales", "revenue", "calls", "conversations", "conversion"].map(
              (v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="Leaderboard period"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPage(0);
            }}
          >
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>
        {metric === "conversion" && (
          <p className="notice">
            Conversion appears only after 100 qualifying calls in the selected
            period.
          </p>
        )}
        <State {...state}>
          <Table
            rows={state.data || []}
            columns={[
              ["rank", "Rank"],
              ["name", "Rep"],
              ["code", "Rep ID"],
              ["sales", "Verified sales"],
              ["revenue_cents", "Revenue"],
              ["xp", "Career XP"],
              ["calls", "Calls"],
              ["conversations", "Conversations"],
              ["conversion", "Conversion %"],
            ]}
          />
        </State>
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Your nearby ranking is included.</span>
          <button
            disabled={!state.data?.some((r: Row) => r.rank === (page + 1) * 50)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
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
