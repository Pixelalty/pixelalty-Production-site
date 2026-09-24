import { useEffect, useState } from "react";
import { ArrowRight, Phone, Pause, Play, Check, BookOpen } from "lucide-react";
import {
  useApp,
  useData,
  Heading,
  Card,
  State,
  Form,
  Badge,
  Modal,
} from "./lib";
import { callingWindow, OUTCOMES, label, type Row } from "../shared/core";
import { FollowupDialog, DealDialog } from "./pages";
import { BusinessDetails } from "./details";

export function Focus() {
  const app = useApp(),
    selected = new URLSearchParams(location.search).get("business");
  const [page, setPage] = useState(0),
    [visited, setVisited] = useState<string[]>([]),
    [script, setScript] = useState(""),
    [outcome, setOutcome] = useState("no_answer"),
    [notes, setNotes] = useState(""),
    [dialog, setDialog] = useState(""),
    [dialogLead, setDialogLead] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [requestId, setRequestId] = useState(crypto.randomUUID()),
    [summary, setSummary] = useState(false),
    [seconds, setSeconds] = useState(0);
  const queue = useData(
      `/table?name=businesses&own=true&queue=true&page=${page}${selected ? `&id=${selected}` : ""}`,
    ),
    scripts = useData("/table?name=content&kind=script&active=true"),
    sessionState = useData("/report?kind=session");
  const session = sessionState.data,
    live = session && !session.ended_at,
    paused = !!session?.paused_at;
  const lead = queue.data?.rows.find((r: Row) => !visited.includes(r.id));
  const scriptRows = scripts.data?.rows || [],
    guide = scriptRows.find((r: Row) => r.id === script) || scriptRows[0];
  const allowed = lead
    ? callingWindow(
        lead.timezone,
        app.ctx.settings.calling_enabled,
        new Date(),
        app.ctx.settings.call_start,
        app.ctx.settings.call_end,
      )
    : { allowed: false, reason: "" };
  useEffect(() => {
    setSeconds(0);
    if (!live || paused) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [session, live, paused]);
  function advance() {
    if (lead) setVisited((v) => [...v, lead.id]);
    setNotes("");
    setOutcome("no_answer");
    setRequestId(crypto.randomUUID());
  }
  function show(kind: string) {
    setDialogLead(lead);
    setDialog(kind);
  }
  async function save() {
    if (!lead || busy || paused || !live) return;
    setBusy(true);
    try {
      const current = lead;
      await app.mutate("call", {
        business_id: current.id,
        request_id: requestId,
        outcome,
        notes,
        script_id: guide?.id,
        session_id: session.id,
      });
      advance();
      if (["follow_up", "meeting", "send_information"].includes(outcome)) {
        setDialogLead(current);
        setDialog("followup");
      }
      app.notify("Call outcome saved.");
    } catch (e) {
      app.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (app.ctx.rep.preferences?.shortcuts === false) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        dialog ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)
      )
        return;
      const key = e.key.toLowerCase();
      const outcomes: Record<string, string> = {
        "1": "no_answer",
        "2": "voicemail",
        "3": "conversation",
        "4": "interested",
        "5": "follow_up",
        d: "do_not_call",
      };
      if (outcomes[key]) {
        e.preventDefault();
        setOutcome(outcomes[key]);
      }
      if (key === "n") {
        e.preventDefault();
        if (notes) setDialog("discard");
        else advance();
      }
      if (key === "f" && lead) {
        e.preventDefault();
        show("followup");
      }
      if (key === "c" && allowed.allowed && !paused && live && lead) {
        e.preventDefault();
        location.assign("tel:" + lead.phone);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    lead,
    notes,
    dialog,
    paused,
    live,
    allowed.allowed,
    app.ctx.rep.preferences?.shortcuts,
  ]);
  const elapsed = (session?.active_seconds || 0) + seconds;
  return (
    <>
      <Heading
        eyebrow="FOCUS MODE"
        title="One conversation at a time."
        description="Manual calling · Accurate outcomes and a clear next step."
      >
        {live && (
          <>
            <span className="badge">
              {session.calls || 0} / {session.target_calls} calls ·{" "}
              {Math.floor(elapsed / 60)} active minutes
            </span>
            <button
              onClick={() =>
                app.run(() =>
                  app.mutate(paused ? "session_resume" : "session_pause"),
                )
              }
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}{" "}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() =>
                app.run(async () => {
                  await app.mutate("session_end");
                  setSummary(true);
                })
              }
            >
              End session
            </button>
          </>
        )}
      </Heading>
      {!live && (
        <Card title={summary ? "Session complete" : "Start a focus session"}>
          {session && (
            <div className="stats">
              <div>
                <strong>{session.calls}</strong>
                <small>Calls logged</small>
              </div>
              <div>
                <strong>{session.conversations}</strong>
                <small>Conversations</small>
              </div>
              <div>
                <strong>{session.interested}</strong>
                <small>Interested</small>
              </div>
              <div>
                <strong>+{session.xp}</strong>
                <small>Career XP</small>
              </div>
            </div>
          )}
          <Form
            fields={[
              {
                name: "target_calls",
                label: "Call target",
                type: "number",
                min: 1,
                max: 500,
                required: true,
              },
              {
                name: "target_minutes",
                label: "Time target (minutes)",
                type: "number",
                min: 1,
                max: 480,
                required: true,
              },
            ]}
            initial={{ target_calls: 20, target_minutes: 30 }}
            submit="Start session"
            onSubmit={async (p) => {
              await app.mutate("session_start", p);
              setVisited([]);
              setSummary(false);
            }}
          />
        </Card>
      )}
      {live && (
        <>
          <progress
            aria-label="Focus call target"
            value={Math.min(session.calls || 0, session.target_calls)}
            max={session.target_calls}
          />
          {paused && (
            <p className="notice" role="status">
              Session paused. Paused time is excluded from your summary.
            </p>
          )}
          <State {...queue}>
            {!lead ? (
              <Card title="You’ve reached the end of this queue">
                <p>
                  Your saved activity is in the session summary. Take a break or
                  choose another batch.
                </p>
                <div className="actions">
                  {!selected && (page + 1) * 50 < (queue.data?.total || 0) && (
                    <button onClick={() => setPage(page + 1)}>
                      Next page of leads
                    </button>
                  )}
                  <button onClick={() => app.navigate("/leads")}>
                    Open my leads
                  </button>
                  <button
                    className="primary"
                    onClick={() =>
                      app.run(async () => {
                        await app.mutate("session_end");
                        setSummary(true);
                      })
                    }
                  >
                    Finish session
                  </button>
                </div>
              </Card>
            ) : (
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
                    className={`call-number ${!allowed.allowed || paused ? "disabled" : ""}`}
                    aria-disabled={!allowed.allowed || paused}
                    href={
                      allowed.allowed && !paused
                        ? `tel:${lead.phone}`
                        : undefined
                    }
                  >
                    <Phone size={22} />
                    {lead.phone}
                  </a>
                  <div className={`notice ${allowed.allowed ? "success" : ""}`}>
                    {allowed.reason}
                  </div>
                  <div className="detail-grid">
                    <div>
                      <small>Decision maker</small>
                      <strong>{lead.contact || "Not provided"}</strong>
                    </div>
                    <div>
                      <small>Website</small>
                      {lead.domain ? (
                        <a
                          href={`https://${lead.domain}`}
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
                    <button onClick={() => show("detail")}>
                      Details & history
                    </button>
                    <button onClick={() => show("followup")}>
                      Schedule follow-up
                    </button>
                    <button onClick={() => show("deal")}>Create deal</button>
                  </div>
                  <div className="divider" />
                  <h3>Log the outcome</h3>
                  <div className="outcomes">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o}
                        aria-pressed={outcome === o}
                        className={outcome === o ? "selected" : ""}
                        onClick={() => setOutcome(o)}
                      >
                        {label(o)}
                      </button>
                    ))}
                  </div>
                  {outcome === "do_not_call" && (
                    <p className="notice">
                      Saving this outcome suppresses this number for every rep
                      and cancels its open follow-ups.
                    </p>
                  )}
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
                      onClick={save}
                    >
                      {busy ? "Saving…" : "Save outcome"}
                      <Check size={16} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => (notes ? setDialog("discard") : advance())}
                    >
                      Next business
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <details className="shortcut-help">
                    <summary>Keyboard shortcuts</summary>
                    <p>
                      C call · 1 no answer · 2 voicemail · 3 conversation · 4
                      interested · 5 follow-up · D do not call · F schedule
                      follow-up · N next business. Shortcuts select an outcome;
                      use Save to record it. Disable them in My profile.
                    </p>
                  </details>
                </Card>
                <div>
                  <Card
                    title="Conversation guide"
                    extra={<BookOpen size={18} />}
                  >
                    <State {...scripts}>
                      <div className="script-tabs">
                        {scriptRows.map((s: Row) => (
                          <button
                            className={s.id === guide?.id ? "selected" : ""}
                            key={s.id}
                            onClick={() => setScript(s.id)}
                          >
                            {s.title}
                          </button>
                        ))}
                      </div>
                      <h3>{guide?.title}</h3>
                      <div className="script-copy">
                        {guide?.body
                          ?.replaceAll("[business name]", lead.name)
                          .replaceAll("[your name]", app.ctx.rep.name)
                          .replaceAll("\\n", "\n")}
                      </div>
                    </State>
                  </Card>
                  <Card title="Session progress">
                    <p>
                      {session.conversations || 0} conversations ·{" "}
                      {session.interested || 0} interested ·{" "}
                      {session.followups || 0} follow-ups
                    </p>
                    <p>
                      {session.calls
                        ? Math.round(
                            (100 * session.conversations) / session.calls,
                          )
                        : 0}
                      % conversation rate · {session.xp || 0} XP
                    </p>
                    <small className="muted">
                      Activity is self-reported. A sale is verified only after
                      payment is confirmed.
                    </small>
                  </Card>
                </div>
              </div>
            )}
          </State>
        </>
      )}
      {dialog === "followup" && dialogLead && (
        <FollowupDialog lead={dialogLead} onClose={() => setDialog("")} />
      )}
      {dialog === "deal" && dialogLead && (
        <DealDialog lead={dialogLead} onClose={() => setDialog("")} />
      )}
      {dialog === "detail" && dialogLead && (
        <BusinessDetails id={dialogLead.id} onClose={() => setDialog("")} />
      )}
      {dialog === "discard" && (
        <Modal title="Leave these unsaved notes?" onClose={() => setDialog("")}>
          <p>Save the outcome first to retain these notes.</p>
          <div className="actions">
            <button onClick={() => setDialog("")}>Keep editing</button>
            <button
              onClick={() => {
                advance();
                setDialog("");
              }}
            >
              Discard notes and continue
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
