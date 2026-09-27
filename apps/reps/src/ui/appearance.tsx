import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Monitor,
  Moon,
  Sun,
  Pin,
  X,
} from "lucide-react";
import { Card, Heading, useApp } from "./lib";
import {
  accentOptions,
  defaultWorkspacePreferences,
  type WorkspacePreferences,
} from "../shared/workspace";
import type { WorkspacePage } from "./navigation";
import { ProfileStudio } from "./profile-studio";

type Tab = "profile" | "workspace" | "navigation" | "motion";
export function Appearance() {
  const app = useApp();
  const initial = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<Tab>(
    ["profile", "workspace", "navigation", "motion"].includes(initial || "")
      ? (initial as Tab)
      : app.ctx.rep
        ? "profile"
        : "workspace",
  );
  const [draft, setDraft] = useState<WorkspacePreferences>(app.preferences),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(app.preferences);
  useEffect(() => {
    app.previewPreferences(draft);
  }, [draft]);
  useEffect(() => () => app.previewPreferences(null), []);
  // Navigation expansion may be saved while this page is open. Keep that
  // independent state instead of overwriting it with an old settings draft.
  useEffect(() => {
    setDraft((d) => ({
      ...d,
      navigation_open: app.preferences.navigation_open,
    }));
  }, [JSON.stringify(app.preferences.navigation_open)]);
  const change = (p: Partial<WorkspacePreferences>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
    setError("");
  };
  const pages = app.pages.filter(
    (p: WorkspacePage) => !["/", "/appearance"].includes(p.to),
  ) as WorkspacePage[];
  const select = (
    key: keyof WorkspacePreferences,
    title: string,
    options: [string, string][],
  ) => (
    <label className="field" key={key}>
      {title}
      <select
        aria-label={title}
        value={String(draft[key])}
        disabled={busy}
        onChange={(e) =>
          change({
            [key]: e.target.value,
            ...(key === "motion"
              ? { reduced_motion: ["off", "reduced"].includes(e.target.value) }
              : {}),
          })
        }
      >
        {options.map(([value, name]) => (
          <option value={value} key={value}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  const move = (
    key: "pinned" | "widgets",
    index: number,
    direction: number,
  ) => {
    const list = [...draft[key]];
    [list[index], list[index + direction]] = [
      list[index + direction],
      list[index],
    ];
    change({ [key]: list });
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await app.savePreferences(draft);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Heading
        eyebrow="MAKE IT YOURS"
        title="Appearance"
        description="A profile your team can recognize. A workspace that feels like yours."
      />
      <div
        className="appearance-tabs"
        role="tablist"
        aria-label="Appearance settings"
      >
        {(["profile", "workspace", "navigation", "motion"] as Tab[])
          .filter((t) => t !== "profile" || app.ctx.rep)
          .map((t) => (
            <button
              key={t}
              id={"tab-" + t}
              role="tab"
              aria-selected={tab === t}
              aria-controls={"panel-" + t}
              onClick={() => {
                setTab(t);
                history.replaceState(null, "", "/appearance?tab=" + t);
              }}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
      </div>
      {tab === "profile" ? (
        <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile">
          <ProfileStudio />
        </div>
      ) : (
        <form
          className="appearance-form"
          role="tabpanel"
          id={"panel-" + tab}
          aria-labelledby={"tab-" + tab}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="appearance-grid">
            {tab === "workspace" && (
              <>
                <div>
                  <Card title="Color & theme">
                    <fieldset disabled={busy}>
                      <legend>Theme</legend>
                      <div className="theme-options">
                        {(
                          [
                            { value: "light", title: "Light", icon: Sun },
                            { value: "dark", title: "Dark", icon: Moon },
                            { value: "system", title: "System", icon: Monitor },
                          ] as const
                        ).map(({ value, title, icon: Icon }) => (
                          <label
                            className={
                              "theme-option " +
                              (draft.theme === value ? "chosen" : "")
                            }
                            key={value}
                          >
                            <input
                              type="radio"
                              name="workspace-theme"
                              checked={draft.theme === value}
                              onChange={() => change({ theme: value })}
                            />
                            <span
                              className={"theme-sample sample-" + value}
                              aria-hidden="true"
                            >
                              <i />
                              <span>
                                <b />
                                <b />
                                <b />
                              </span>
                            </span>
                            <span>
                              <Icon size={16} />
                              {title}
                              {draft.theme === value && <Check size={16} />}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset disabled={busy}>
                      <legend>Accent color</legend>
                      <div className="accent-options">
                        {accentOptions.map((a) => (
                          <label
                            className={
                              "accent-option " +
                              (draft.accent === a.value ? "chosen" : "")
                            }
                            key={a.value}
                          >
                            <input
                              type="radio"
                              name="workspace-accent"
                              checked={draft.accent === a.value}
                              onChange={() => change({ accent: a.value })}
                            />
                            <span
                              style={{ background: a.color }}
                              aria-hidden="true"
                            >
                              {draft.accent === a.value && <Check size={15} />}
                            </span>
                            {a.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {select("background", "Workspace background", [
                      ["solid", "Solid"],
                      ["wash", "Subtle wash"],
                      ["dots", "Fine dots"],
                      ["grid", "Quiet grid"],
                    ])}
                    {select("sidebar", "Sidebar surface", [
                      ["contrast", "Contrasting sidebar"],
                      ["matching", "Match my theme"],
                    ])}
                  </Card>
                  <Card title="Typography & spacing">
                    {select("font", "Font", [
                      ["sans", "Pixelalty — Manrope"],
                      ["humanist", "Humanist — Trebuchet"],
                      ["system", "Your system font"],
                    ])}
                    {select("text_size", "Text size", [
                      ["standard", "Standard"],
                      ["large", "Larger"],
                    ])}
                    {select("heading_scale", "Heading scale", [
                      ["compact", "Compact"],
                      ["standard", "Standard"],
                      ["expressive", "Expressive"],
                    ])}
                    {select("density", "Spacing", [
                      ["compact", "Compact"],
                      ["comfortable", "Comfortable"],
                      ["spacious", "Spacious"],
                    ])}
                    {select("content_width", "Content width", [
                      ["focused", "Focused"],
                      ["balanced", "Balanced"],
                      ["wide", "Wide"],
                    ])}
                  </Card>
                </div>
                <div>
                  <Card title="Cards & controls">
                    {select("cards", "Card corners", [
                      ["minimal", "Minimal"],
                      ["standard", "Standard"],
                      ["rounded", "Rounded"],
                    ])}
                    {select("card_surface", "Card surface", [
                      ["solid", "Solid"],
                      ["flat", "Flat"],
                      ["glass", "Soft glass"],
                    ])}
                    {select("border_strength", "Border strength", [
                      ["subtle", "Subtle"],
                      ["defined", "Defined"],
                    ])}
                    {select("shadow", "Card shadow", [
                      ["none", "None"],
                      ["soft", "Soft"],
                      ["lifted", "Lifted"],
                    ])}
                    {select("buttons", "Button shape", [
                      ["standard", "Standard"],
                      ["soft", "Soft corners"],
                      ["pill", "Pill"],
                    ])}
                  </Card>
                  <Card title="Dashboard widgets">
                    <p>
                      Next steps and career progress stay visible. Choose the
                      supporting information you see.
                    </p>
                    <ol className="pin-order">
                      {draft.widgets.map((w, i) => (
                        <li key={w}>
                          <label className="preference-check">
                            <input
                              type="checkbox"
                              checked={!draft.hidden_widgets.includes(w)}
                              onChange={(e) =>
                                change({
                                  hidden_widgets: e.target.checked
                                    ? draft.hidden_widgets.filter(
                                        (v) => v !== w,
                                      )
                                    : [...draft.hidden_widgets, w],
                                })
                              }
                            />
                            {w === "goals"
                              ? "Monthly goals"
                              : "Team leaderboard"}
                          </label>
                          <button
                            type="button"
                            aria-label={"Move " + w + " up"}
                            disabled={i === 0}
                            onClick={() => move("widgets", i, -1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label={"Move " + w + " down"}
                            disabled={i === draft.widgets.length - 1}
                            onClick={() => move("widgets", i, 1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                        </li>
                      ))}
                    </ol>
                    <fieldset>
                      <legend>Displayed achievements</legend>
                      {[
                        ["first_call", "First qualifying call"],
                        ["first_sale", "First verified sale"],
                        ["trained", "Required training complete"],
                      ].map(([v, n]) => (
                        <label className="preference-check" key={v}>
                          <input
                            type="checkbox"
                            checked={draft.achievements.includes(v)}
                            onChange={(e) =>
                              change({
                                achievements: e.target.checked
                                  ? [...draft.achievements, v]
                                  : draft.achievements.filter((x) => x !== v),
                              })
                            }
                          />
                          {n}
                        </label>
                      ))}
                      <p className="muted">
                        Only achievements you have earned are displayed.
                      </p>
                    </fieldset>
                  </Card>
                </div>
              </>
            )}
            {tab === "navigation" && (
              <>
                <Card title="Sidebar & sections">
                  {select("sidebar_mode", "Sidebar width", [
                    ["expanded", "Normal"],
                    ["wide", "Wider"],
                    ["compact", "Compact"],
                    ["collapsed", "Narrow"],
                  ])}
                  {select("icon_size", "Navigation icon size", [
                    ["standard", "Standard"],
                    ["large", "Larger"],
                  ])}
                  {select("navigation_mode", "Navigation section behavior", [
                    ["multiple", "Allow multiple sections open"],
                    ["single", "Keep only one section open"],
                  ])}
                  <p>
                    Open sections stay open when you change pages. Your
                    preference is saved to your account. On smaller screens,
                    selecting a page closes the drawer while retaining its
                    sections.
                  </p>
                </Card>
                <Card title="Your pinned pages" extra={<Pin size={18} />}>
                  <p>Keep up to six destinations at the top of your sidebar.</p>
                  <ol className="pin-order">
                    {draft.pinned.map((to, i) => (
                      <li key={to}>
                        <span>
                          {pages.find((p) => p.to === to)?.title ||
                            "Unavailable page"}
                        </span>
                        <button
                          type="button"
                          aria-label={"Move pinned page " + (i + 1) + " up"}
                          disabled={i === 0}
                          onClick={() => move("pinned", i, -1)}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={"Move pinned page " + (i + 1) + " down"}
                          disabled={i === draft.pinned.length - 1}
                          onClick={() => move("pinned", i, 1)}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={
                            "Unpin " +
                            (pages.find((p) => p.to === to)?.title || "page")
                          }
                          onClick={() =>
                            change({
                              pinned: draft.pinned.filter((p) => p !== to),
                            })
                          }
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="pin-options">
                    {pages.map(({ to, title, icon: Icon }) => (
                      <label className="preference-check" key={to}>
                        <input
                          type="checkbox"
                          checked={draft.pinned.includes(to)}
                          disabled={
                            busy ||
                            (!draft.pinned.includes(to) &&
                              draft.pinned.length >= 6)
                          }
                          onChange={(e) =>
                            change({
                              pinned: e.target.checked
                                ? [...draft.pinned, to]
                                : draft.pinned.filter((p) => p !== to),
                            })
                          }
                        />
                        <Icon size={17} />
                        {title}
                      </label>
                    ))}
                  </div>
                </Card>
              </>
            )}
            {tab === "motion" && (
              <>
                <Card title="Motion that suits you">
                  {select("motion", "Motion", [
                    ["off", "Off"],
                    ["reduced", "Subtle — reduced motion"],
                    ["normal", "Full"],
                    ["premium", "Premium"],
                  ])}
                  <p>
                    Off and Subtle use static versions of animated profile
                    images. Your device's Reduce Motion setting always takes
                    priority.
                  </p>
                  <p>
                    Full adds gentle transitions. Premium adds a little more
                    depth to hovering cards and controls.
                  </p>
                </Card>
                <Card title="Comfort comes first">
                  <p>
                    Your selected cosmetics remain equipped when motion is
                    reduced. Colleagues see them using their own motion
                    preferences.
                  </p>
                  <div className="motion-preview">
                    <span className="motion-orbit" />
                    <strong>Deliberate, quiet motion</strong>
                  </div>
                </Card>
              </>
            )}
          </div>
          <div className="preference-savebar">
            <div aria-live="polite">
              {error ? (
                <span className="form-error" role="alert">
                  {error}
                </span>
              ) : saved ? (
                <span className="saved-message">
                  <Check size={16} /> Appearance saved to your account.
                </span>
              ) : (
                <span className="muted">
                  {dirty
                    ? "Previewing unsaved changes"
                    : "Your saved workspace preferences"}
                </span>
              )}
            </div>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => change({ ...defaultWorkspacePreferences })}
              >
                Reset to defaults
              </button>
              {dirty && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(app.preferences);
                    setError("");
                    setSaved(false);
                  }}
                >
                  Cancel changes
                </button>
              )}
              <button className="primary" disabled={busy || !dirty}>
                {busy ? "Saving…" : "Save appearance"}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
