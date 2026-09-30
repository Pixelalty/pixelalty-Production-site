import { ProfileAvatar, SharedIdentity } from "./profile-identity";
import { useState } from "react";
import { careerProgress } from "../shared/progression";
import { timezoneOptions, scheduledInstant } from "../shared/timezones";
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
  MessageCircle,
} from "lucide-react";
import {
  useApp,
  useData,
  State,
  Heading,
  Card,
  Form,
  Modal,
  Listing,
  Table,
  LinkButton,
  type Field,
} from "./lib";
import { money, label, type Row } from "../shared/core";
import { BusinessDetails } from "./details";
import { AvailableLeads } from "./lead-management";
import { SupportChannels } from "./operations-settings";
import { PayoutSetup, SalesCode } from "./payouts";
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function Dashboard() {
  const app = useApp(),
    state = useData("/report?kind=dashboard", 15000),
    board = useData(
      app.ctx.access_options?.leaderboard === false && !app.has("sales_admin")
        ? null
        : "/report?kind=leaderboard",
    );
  const widgetStyle = (key: string) => ({
    order: 3 + app.preferences.widgets.indexOf(key),
    display:
      app.preferences.hidden_widgets.includes(key) ||
      (key === "leaderboard" && app.ctx.access_options?.leaderboard === false)
        ? "none"
        : undefined,
  });
  const d = state.data || {},
    progress = careerProgress(
      app.ctx.career_xp ?? d.xp ?? 0,
      app.ctx.settings?.xp_per_level ?? d.level_step,
    ),
    { xp, step, level } = progress;
  return (
    <>
      <Heading
        title={`Hello, ${app.ctx.rep?.name.split(" ")[0] || "there"}.`}
        description="A clear view of today. One good conversation at a time."
      />
      <SalesCode />
      <button
        className="support-callout"
        onClick={() => app.navigate("/support")}
      >
        <MessageCircle size={19} aria-hidden="true" />
        <span>
          <strong>Need to instantly contact Pixelalty Support?</strong>
          <small>
            Click here for WhatsApp, Instagram, email, or a support ticket.
          </small>
        </span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
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
          <section className="focus-hero" style={{ order: 0 }}>
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
          <Card
            title="Your progression"
            style={{ order: 1 }}
            extra={<Trophy size={20} />}
          >
            <div className="progress-profile">
              <ProfileAvatar
                name={app.ctx.rep?.name || "Pixelalty"}
                style={app.ctx.profile?.style}
                size="large"
              />
            </div>
            <h3 className="center" aria-live="polite">
              Level {level.toLocaleString()}
            </h3>
            <p className="center muted">{xp.toLocaleString()} career XP</p>
            <LinkButton to="/xp">View XP history</LinkButton>
            <progress
              aria-label="Career level progress"
              value={progress.within}
              max={step}
              aria-valuetext={`${progress.within} of ${step} XP within level ${level}`}
            />
            <p className="fine-print">
              {progress.within.toLocaleString()} / {step.toLocaleString()} XP
              within this level · {progress.remaining.toLocaleString()} XP to
              level {(level + 1).toLocaleString()}
            </p>
            <p className="fine-print">
              The bar starts again at each new level. Lifetime XP keeps every
              award and correction.
            </p>
            <Streak summary={d.streak || {}} />
          </Card>
          <Card
            title="Your monthly goals"
            style={widgetStyle("goals")}
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
          <Card
            title="Next steps"
            style={{ order: 2 }}
            extra={<Calendar size={20} />}
          >
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
            style={widgetStyle("leaderboard")}
            extra={<LinkButton to="/leaderboard">View all</LinkButton>}
          >
            <State {...board} empty={!board.data?.length}>
              {board.data?.slice(0, 4).map((r: Row) => (
                <div className="leader-row" key={r.id}>
                  <span className="rank">{r.rank}</span>
                  <SharedIdentity rep={r} />
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
  const [detail, setDetail] = useState<string | null>(
      new URLSearchParams(location.search).get("business"),
    ),
    [pool, setPool] = useState(true),
    [favorites, setFavorites] = useState(false),
    [view, setView] = useState("all");
  return (
    <>
      <Heading
        title="Leads"
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
        <button className="primary" onClick={() => setPool(!pool)}>
          {pool ? "My claimed leads" : "Browse available leads"}
        </button>
      </Heading>
      {pool ? (
        <AvailableLeads
          onClaim={(id) => {
            setPool(false);
            setDetail(id);
          }}
        />
      ) : (
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
      )}
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
        Choose the local time and timezone for this follow-up. The prospect is
        in <strong>{lead.timezone}</strong>.
      </p>
      <Form
        initial={{
          timezone: app.ctx.rep?.timezone || zone(),
          occurrence: "earlier",
        }}
        fields={[
          {
            name: "due_at",
            label: "Date and time",
            type: "datetime-local",
            required: true,
          },
          {
            name: "timezone",
            label: "Scheduling timezone",
            required: true,
            options: timezoneOptions(app.ctx.rep?.timezone || zone()),
          },
          {
            name: "occurrence",
            label: "If the clocks repeat this time",
            options: [
              { value: "earlier", label: "First occurrence" },
              { value: "later", label: "Second occurrence" },
            ],
            hint: "Only used during the autumn daylight-saving change.",
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
            due_at: scheduledInstant(p.due_at, p.timezone, p.occurrence),
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
    packages = useData("/table?name=packages&active=true", 60000),
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
          <p>Enter the new local time in the selected scheduling timezone.</p>
          <Form
            initial={{
              note: edit.note,
              priority: edit.priority,
              channel: edit.channel,
              timezone: edit.timezone,
              occurrence: "earlier",
            }}
            fields={[
              {
                name: "due_at",
                label: "New date and time",
                type: "datetime-local",
                required: true,
              },
              {
                name: "timezone",
                label: "Scheduling timezone",
                required: true,
                options: timezoneOptions(edit.timezone),
              },
              {
                name: "occurrence",
                label: "If the clocks repeat this time",
                options: [
                  { value: "earlier", label: "First occurrence" },
                  { value: "later", label: "Second occurrence" },
                ],
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
                due_at: scheduledInstant(p.due_at, p.timezone, p.occurrence),
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
        description="Verified sales, fixed commissions, and payouts confirmed by Pixelalty."
      />
      <State {...totals}>
        <div className="stats">
          {[
            ["hold", "Held commission"],
            ["payable", "Payable"],
            ["paid", "Confirmed paid"],
            ["review", "Under review"],
          ].map(([k, t]) => (
            <Card key={k}>
              <div className="stat-label">{t}</div>
              <div className="stat-value">{money(totals.data?.[k])}</div>
            </Card>
          ))}
        </div>
      </State>
      <SalesCode />
      <PayoutSetup />
      <div className="notice">
        Pixelalty reviews eligible commissions and sends payouts manually
        through Stripe. Paid means an authorized administrator confirmed the
        actual payout. Holds, refunds, and disputes can affect availability.
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
      <h2>Confirmed payouts</h2>
      <Listing
        name="manual_payouts"
        query="&own=true"
        columns={[
          ["amount_cents", "Amount"],
          ["paid_at", "Payment date"],
          ["stripe_reference", "Reference"],
        ]}
      />
      <h2>Legacy payout history</h2>
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
  const state = useData("/table?name=content&active=true&kind=lesson"),
    training = useData("/table?name=training&own=true"),
    packages = useData("/table?name=packages&active=true", 60000),
    app = useApp(),
    [acknowledged, setAcknowledged] = useState(false);
  const essential = state.data?.rows.find(
    (row: Row) => row.slug === "pixelalty-essentials",
  );
  const completed =
    !!essential &&
    training.data?.rows.some(
      (row: Row) => row.content_id === essential.id && row.passed,
    );
  return (
    <>
      <Heading
        eyebrow="GETTING STARTED"
        title="Pixelalty Essentials"
        description="Everything you need to know before you start calling."
      />
      <State {...state}>
        {!essential ? (
          <div className="notice error">
            Pixelalty Essentials is temporarily unavailable. Contact Support.
          </div>
        ) : (
          <div className="essentials-layout">
            <Card title="1. What you’re selling" className="essential-section">
              <p>
                Pixelalty sells clear website packages with fixed rep
                commissions.
              </p>
              <State {...packages}>
                <div className="package-list">
                  {packages.data?.rows
                    .slice()
                    .sort(
                      (a: Row, b: Row) =>
                        a.display_order - b.display_order ||
                        a.code.localeCompare(b.code),
                    )
                    .map((pkg: Row) => (
                      <article key={pkg.id}>
                        <div>
                          <strong>
                            {pkg.name}
                            {pkg.code === "advanced" ? " / Ecommerce" : ""}
                          </strong>
                          <small>
                            {pkg.starts_at ? "Starts at" : "Customer price"}
                          </small>
                        </div>
                        <span>{money(pkg.price_cents)}</span>
                        <div>
                          <strong>{money(pkg.commission_cents)}</strong>
                          <small>Fixed commission</small>
                        </div>
                      </article>
                    ))}
                </div>
              </State>
              <div className="notice">
                Your sales code is how Pixelalty knows a paid customer came from
                you. Give your code to the customer and ask them to enter it in
                the Promotion Code field during Stripe checkout. The customer
                receives 2% off, and your fixed commission is unchanged. After
                Stripe confirms a successful payment using your code, the sale
                is automatically attributed to your account and your fixed
                commission is recorded. If the customer does not enter your code
                during checkout, the sale may not be automatically credited to
                you.
              </div>
              <SalesCode />
            </Card>
            <Card title="2. How the CRM works" className="essential-section">
              <ol className="crm-steps">
                {[
                  "Get or claim an available lead.",
                  "Contact the business.",
                  "Record what happened.",
                  "Add useful factual notes.",
                  "Schedule a follow-up when needed.",
                  "If the customer wants to buy, use the current deal and checkout flow.",
                  "Give the customer your assigned 2% sales code.",
                  "The customer pays through Stripe.",
                  "A verified successful payment using your code creates your sale and fixed commission.",
                ].map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </Card>
            <Card className="essential-completion">
              {completed ? (
                <div className="completion-success">
                  <Check size={21} aria-hidden="true" />
                  <div>
                    <strong>Pixelalty Essentials completed</strong>
                    <p>
                      Your completion is saved to your account and remains
                      available on every device.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <label className="consent-check">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />{" "}
                    I have read and understand Pixelalty Essentials.
                  </label>
                  <button
                    className="primary"
                    disabled={!acknowledged}
                    onClick={() =>
                      app.run(() =>
                        app.mutate("essentials_complete", {
                          acknowledged: true,
                        }),
                      )
                    }
                  >
                    Complete Getting Started <Check size={16} />
                  </button>
                </>
              )}
            </Card>
          </div>
        )}
      </State>
    </>
  );
}
export { Onboarding } from "./onboarding";
export { Profile } from "./account-settings";
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
        eyebrow="PIXELALTY SUPPORT"
        title="Pixelalty Support"
        description="Need help, have a question, or want the latest CRM updates? Choose an option below."
      />
      <SupportChannels />
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
