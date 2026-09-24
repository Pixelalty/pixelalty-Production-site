import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Monitor,
  Moon,
  Sun,
  Palette,
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

export function Appearance() {
  const app = useApp(),
    [draft, setDraft] = useState<WorkspacePreferences>(app.preferences),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(app.preferences);
  useEffect(() => {
    app.previewPreferences(draft);
  }, [draft]);
  useEffect(() => () => app.previewPreferences(null), []);
  const change = (p: Partial<WorkspacePreferences>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
    setError("");
  };
  const pages = app.pages.filter(
    (p: WorkspacePage) => !["/", "/appearance"].includes(p.to),
  ) as WorkspacePage[];
  const move = (index: number, direction: number) => {
    const pinned = [...draft.pinned];
    [pinned[index], pinned[index + direction]] = [
      pinned[index + direction],
      pinned[index],
    ];
    change({ pinned });
  };
  return (
    <>
      <Heading
        eyebrow="MAKE IT YOURS"
        title="Appearance"
        description="Preview your changes here, then save them to your account. Your team's workspace stays theirs."
      />
      <form
        className="appearance-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            await app.savePreferences(draft);
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="appearance-grid">
          <div>
            <Card title="Color & theme" extra={<Palette size={20} />}>
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
                        value={value}
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
                        <Icon size={16} aria-hidden="true" />
                        {title}
                        {draft.theme === value && (
                          <Check size={16} aria-hidden="true" />
                        )}
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
                      <span style={{ background: a.color }} aria-hidden="true">
                        {draft.accent === a.value && <Check size={15} />}
                      </span>
                      {a.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="appearance-sidebar">Sidebar style</label>
                <select
                  id="appearance-sidebar"
                  disabled={busy}
                  value={draft.sidebar}
                  onChange={(e) =>
                    change({
                      sidebar: e.target
                        .value as WorkspacePreferences["sidebar"],
                    })
                  }
                >
                  <option value="contrast">Contrasting sidebar</option>
                  <option value="matching">Match my theme</option>
                </select>
              </div>
            </Card>
            <Card title="Layout & accessibility">
              <div className="preferences-fields">
                <div className="field">
                  <label htmlFor="appearance-density">Spacing</label>
                  <select
                    id="appearance-density"
                    disabled={busy}
                    value={draft.density}
                    onChange={(e) =>
                      change({
                        density: e.target
                          .value as WorkspacePreferences["density"],
                      })
                    }
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="appearance-text">Text size</label>
                  <select
                    id="appearance-text"
                    disabled={busy}
                    value={draft.text_size}
                    onChange={(e) =>
                      change({
                        text_size: e.target
                          .value as WorkspacePreferences["text_size"],
                      })
                    }
                  >
                    <option value="standard">Standard</option>
                    <option value="large">Larger</option>
                  </select>
                </div>
              </div>
              <label className="preference-check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.reduced_motion}
                  onChange={(e) => change({ reduced_motion: e.target.checked })}
                />
                <span>
                  <strong>Reduce motion</strong>
                  <small>Keep transitions and animations to a minimum.</small>
                </span>
              </label>
            </Card>
          </div>
          <Card title="Your pinned pages" extra={<Pin size={18} />}>
            <p>
              Keep up to six destinations at the top of your sidebar. Order them
              to match the way you work.
            </p>
            {draft.pinned.length > 0 && (
              <ol className="pin-order">
                {draft.pinned.map((to, i) => (
                  <li key={to}>
                    <span>
                      {pages.find((p) => p.to === to)?.title ||
                        "Unavailable page"}
                    </span>
                    <button
                      type="button"
                      className="icon"
                      disabled={busy || i === 0}
                      aria-label={
                        "Move " +
                        (pages.find((p) => p.to === to)?.title || "page") +
                        " up"
                      }
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon"
                      disabled={busy || i === draft.pinned.length - 1}
                      aria-label={
                        "Move " +
                        (pages.find((p) => p.to === to)?.title || "page") +
                        " down"
                      }
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon"
                      disabled={busy}
                      aria-label={
                        "Unpin " +
                        (pages.find((p) => p.to === to)?.title ||
                          "unavailable page")
                      }
                      onClick={() =>
                        change({ pinned: draft.pinned.filter((p) => p !== to) })
                      }
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="pin-options">
              {pages.map(({ to, title, icon: Icon }) => (
                <label className="preference-check" key={to}>
                  <input
                    type="checkbox"
                    checked={draft.pinned.includes(to)}
                    disabled={
                      busy ||
                      (!draft.pinned.includes(to) && draft.pinned.length >= 6)
                    }
                    onChange={(e) =>
                      change({
                        pinned: e.target.checked
                          ? [...draft.pinned, to]
                          : draft.pinned.filter((p) => p !== to),
                      })
                    }
                  />
                  <Icon size={17} aria-hidden="true" />
                  <span>{title}</span>
                </label>
              ))}
            </div>
          </Card>
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
    </>
  );
}
