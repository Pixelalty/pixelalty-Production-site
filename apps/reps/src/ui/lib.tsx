import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { X, LoaderCircle } from "lucide-react";
import { label, money, type Row } from "../shared/core";
let auth: SupabaseClient;
export function setClient(value: SupabaseClient) {
  auth = value;
}
export async function api(path: string, data?: unknown): Promise<any> {
  const session = auth ? await auth.auth.getSession() : null;
  const response = await fetch("/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(data instanceof FormData
        ? {}
        : data === undefined
          ? {}
          : { "content-type": "application/json" }),
      ...(session?.data.session
        ? { Authorization: "Bearer " + session.data.session.access_token }
        : {}),
    },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  const out = (await response.json().catch(() => ({
    error: "The service returned an unreadable response. Please try again.",
  }))) as Row;
  if (!response.ok) throw Error(out.error || "The request failed.");
  return out;
}
export async function uploadPdf(file: File, requestId: string) {
  const session = await auth.auth.getSession();
  const response = await fetch("/api/tax/upload", {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "x-upload-id": requestId,
      Authorization: "Bearer " + session.data.session?.access_token,
    },
    body: file,
  });
  const out = (await response
    .json()
    .catch(() => ({
      error: "Your upload could not be confirmed. Retry the same file.",
    }))) as Row;
  if (!response.ok)
    throw Error(out.error || "Your upload could not be confirmed.");
  return out;
}
export async function download(path: string, filename: string, data?: unknown) {
  const session = await auth.auth.getSession();
  const r = await fetch("/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + session.data.session?.access_token,
      ...(data === undefined ? {} : { "content-type": "application/json" }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!r.ok) {
    const error = (await r.json().catch(() => ({}))) as Row;
    throw Error(error.error || "Download failed. Please try again.");
  }
  const url = URL.createObjectURL(await r.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export const AppContext = createContext<any>(null);
export const useApp = () => useContext(AppContext);
export function useData(path: string, pollMs = 0) {
  const { version } = useApp();
  const [state, set] = useState<{ data: any; error: string; loading: boolean }>(
    { data: null, error: "", loading: true },
  );
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: "" }));
    api(path)
      .then((data) => live && set({ data, error: "", loading: false }))
      .catch(
        (e) => live && set({ data: null, error: e.message, loading: false }),
      );
    return () => {
      live = false;
    };
  }, [path, version]);
  useEffect(() => {
    if (!pollMs) return;
    let live = true,
      pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const data = await api(path);
        if (live)
          set((previous) =>
            previous.loading ||
            JSON.stringify(previous.data) === JSON.stringify(data)
              ? previous
              : { data, error: "", loading: false },
          );
      } catch {
        /* Keep the visible form intact; explicit refreshes show errors. */
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void refresh(), pollMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [path, pollMs, version]);
  return state;
}
export function State({
  loading,
  error,
  children,
  empty = false,
  emptyText = "No records match this view. Try changing the filters or add your first record.",
}: {
  loading?: boolean;
  error?: string;
  children?: ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  if (loading)
    return (
      <div className="state" role="status" aria-live="polite">
        <LoaderCircle className="spin" /> Loading…
      </div>
    );
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}
      </div>
    );
  if (empty) return <div className="state">{emptyText}</div>;
  return <>{children}</>;
}
export function Badge({ value }: { value: string }) {
  return <span className={"badge " + value}>{label(value)}</span>;
}
export function Heading({
  eyebrow = "YOUR WORKSPACE",
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Card({
  title,
  children,
  extra,
}: {
  title?: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <h2>{title}</h2>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const el = ref.current;
    (
      el?.querySelector<HTMLElement>("[data-autofocus]") ||
      el?.querySelector<HTMLElement>("input,select,textarea,button")
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (
        document
          .querySelectorAll(".modal")
          .item(document.querySelectorAll(".modal").length - 1) !== el
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const a = Array.from(
          el?.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ) || [],
        ).filter(
          (x) => !x.hasAttribute("disabled") && x.getClientRects().length,
        );
        const first = a[0],
          last = a[a.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="card-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close dialog" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  hint?: string;
  searchTable?: string;
  searchQuery?: string;
  minLength?: number;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "email";
  autoComplete?: string;
  pattern?: string;
};
function SearchField({
  field,
  initial,
  id,
}: {
  field: Field;
  initial?: string;
  id: string;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [value, setValue] = useState(initial || "");
  const state = useData(
    `/table?name=${field.searchTable}&page=${page}&q=${encodeURIComponent(search)}${field.searchQuery || ""}`,
  );
  return (
    <div className="search-field">
      <input
        type="search"
        aria-label={`Search ${field.label}`}
        placeholder="Search name or ID…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />
      <select
        id={id}
        name={field.name}
        required={field.required}
        aria-label={field.label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">Choose…</option>
        {value && !state.data?.rows.some((r: Row) => r.id === value) && (
          <option value={value}>Selected record</option>
        )}
        {state.data?.rows.map((r: Row) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.code}
          </option>
        ))}
      </select>
      <State loading={state.loading} error={state.error} />
      <div className="pagination">
        <button
          type="button"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous results
        </button>
        <button
          type="button"
          disabled={(page + 1) * 50 >= (state.data?.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          More results
        </button>
      </div>
    </div>
  );
}
export function Form({
  fields,
  initial = {},
  submit,
  onSubmit,
  children,
}: {
  fields: Field[];
  initial?: Row;
  submit: string;
  onSubmit: (p: Row) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  const formId = useId();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const fd = new FormData(e.currentTarget),
          p: Row = { ...initial };
        for (const f of fields) {
          p[f.name] =
            f.type === "checkbox"
              ? fd.get(f.name) === "on"
              : f.type === "currency"
                ? currencyInput(String(fd.get(f.name) || ""))
                : f.type === "number"
                  ? Number(fd.get(f.name))
                  : fd.get(f.name);
        }
        setBusy(true);
        setError("");
        setSuccess(false);
        try {
          await onSubmit(p);
          setSuccess(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <div
          className={"field " + (f.type === "checkbox" ? "check" : "")}
          key={f.name}
        >
          <label htmlFor={formId + f.name}>{f.label}</label>
          {f.searchTable ? (
            <SearchField
              field={f}
              initial={initial[f.name]}
              id={formId + f.name}
            />
          ) : f.type === "textarea" ? (
            <textarea
              id={formId + f.name}
              name={f.name}
              defaultValue={initial[f.name] ?? ""}
              required={f.required}
              rows={4}
              minLength={f.minLength}
              maxLength={f.maxLength || 100000}
            />
          ) : f.options ? (
            <select
              id={formId + f.name}
              name={f.name}
              defaultValue={initial[f.name] ?? ""}
              required={f.required}
            >
              <option value="">Choose…</option>
              {f.options.map((o) => (
                <option value={o.value} key={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={formId + f.name}
              name={f.name}
              type={f.type === "currency" ? "text" : f.type || "text"}
              inputMode={f.type === "currency" ? "decimal" : f.inputMode}
              autoComplete={f.autoComplete}
              pattern={
                f.type === "currency" ? "[0-9]+([.][0-9]{1,2})?" : f.pattern
              }
              defaultValue={
                f.type === "checkbox"
                  ? undefined
                  : f.type === "currency" && initial[f.name] != null
                    ? (initial[f.name] / 100).toFixed(2)
                    : (initial[f.name] ?? "")
              }
              defaultChecked={
                f.type === "checkbox" ? !!initial[f.name] : undefined
              }
              required={f.required}
              min={f.min}
              max={f.max}
              minLength={f.minLength}
              maxLength={f.maxLength}
            />
          )}
          {f.hint && <small>{f.hint}</small>}
        </div>
      ))}
      {children}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <p className="notice success" role="status">
          Saved successfully.
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : submit}
      </button>
    </form>
  );
}
function currencyInput(value: string) {
  if (!value) return undefined;
  const [dollars, cents = ""] = value.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}
export function ActionDialog({
  title,
  action,
  initial,
  fields = [],
  onClose,
  endpoint = "/action",
  after,
}: {
  title: string;
  action: string;
  initial: Row;
  fields?: Field[];
  onClose: () => void;
  endpoint?: string;
  after?: (r: any) => void;
}) {
  const app = useApp();
  return (
    <Modal title={title} onClose={onClose}>
      <Form
        fields={[
          ...fields,
          {
            name: "reason",
            label: "Reason for this change",
            type: "textarea",
            required: true,
          },
        ]}
        initial={initial}
        submit={title}
        onSubmit={async (p) => {
          const r = await api(
            endpoint,
            endpoint === "/action" ? { action, p } : p,
          );
          app.refresh();
          app.notify(
            endpoint === "/invite/resend"
              ? "Account setup email sent."
              : "Saved.",
          );
          after?.(r);
          onClose();
        }}
      />
    </Modal>
  );
}
export function Table({
  rows,
  columns,
  actions,
}: {
  rows: Row[];
  columns: [string, string][];
  actions?: (row: Row) => ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([k, v]) => (
              <th key={k}>{v}</th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map(([k]) => (
                <td key={k}>
                  {k.includes("cents") ? (
                    money(r[k])
                  ) : ["status", "stage", "classification"].includes(k) ? (
                    <Badge value={r[k] || "pending"} />
                  ) : k.endsWith("_at") ? (
                    r[k] ? (
                      new Date(r[k]).toLocaleString()
                    ) : (
                      "—"
                    )
                  ) : typeof r[k] === "object" ? (
                    JSON.stringify(r[k])
                  ) : (
                    String(r[k] ?? "—")
                  )}
                </td>
              ))}
              {actions && (
                <td>
                  <div className="row-actions">{actions(r)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <State empty />}
    </div>
  );
}
const tableFilters: Record<string, { key: string; values: string[] }[]> = {
  businesses: [
    {
      key: "stage",
      values: [
        "new",
        "working",
        "interested",
        "follow_up",
        "meeting",
        "proposal",
        "won",
        "lost",
        "dnc",
      ],
    },
  ],
  applicants: [
    {
      key: "stage",
      values: [
        "new",
        "review",
        "interview",
        "interview_scheduled",
        "offer",
        "onboarding",
        "activated",
        "rejected",
        "withdrawn",
        "inactive",
        "approval_error",
      ],
    },
  ],
  reps: [
    {
      key: "status",
      values: ["onboarding", "active", "suspended", "offboarded"],
    },
  ],
  deals: [
    { key: "stage", values: ["proposal", "checkout", "paid", "cancelled"] },
  ],
  content: [
    {
      key: "kind",
      values: [
        "lesson",
        "quiz",
        "script",
        "knowledge",
        "announcement",
        "agreement",
      ],
    },
  ],
  commissions: [
    {
      key: "status",
      values: [
        "hold",
        "payable",
        "queued",
        "transferred",
        "recovery_review",
        "reversed",
      ],
    },
  ],
};
export function Listing({
  name,
  columns,
  actions,
  query = "",
  children,
}: {
  name: string;
  columns: [string, string][];
  actions?: (row: Row) => ReactNode;
  query?: string;
  children?: ReactNode;
}) {
  const app = useApp(),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [board, setBoard] = useState(false),
    [visible, setVisible] = useState(columns.map((c) => c[0])),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(0), [query]);
  const parameters = new URLSearchParams({
    ...filters,
    ...(debounced ? { q: debounced } : {}),
  });
  const state = useData(
    `/table?name=${name}&page=${page}${query}&${parameters}`,
  );
  const editable = !!tableFilters[name];
  return (
    <Card>
      <div className="toolbar">
        {["businesses", "reps", "applicants", "deals", "content"].includes(
          name,
        ) && (
          <input
            type="search"
            aria-label={`Search ${label(name)}`}
            placeholder={
              name === "content"
                ? "Search titles and content…"
                : "Search name or ID…"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        )}
        {(tableFilters[name] || []).map((f) => (
          <select
            key={f.key}
            aria-label={`Filter ${label(f.key)}`}
            value={filters[f.key] || ""}
            onChange={(e) => {
              setFilters({ ...filters, [f.key]: e.target.value });
              setPage(0);
            }}
          >
            <option value="">All {label(f.key)}</option>
            {f.values.map((v) => (
              <option key={v} value={v}>
                {label(v)}
              </option>
            ))}
          </select>
        ))}
        {editable && (
          <select
            aria-label="Sort order"
            value={filters.sort || "created_at"}
            onChange={(e) => {
              setFilters({
                ...filters,
                sort: e.target.value,
                direction: e.target.value === "created_at" ? "desc" : "asc",
              });
              setPage(0);
            }}
          >
            <option value="created_at">Newest first</option>
            {["businesses", "reps", "applicants"].includes(name) && (
              <option value="name">Name A–Z</option>
            )}
            {name === "deals" && (
              <option value="price_cents">Sale amount</option>
            )}
          </select>
        )}
        {["businesses", "applicants", "deals"].includes(name) && (
          <button onClick={() => setBoard(!board)}>
            {board ? "Table view" : "Board view"}
          </button>
        )}
        <details className="column-picker">
          <summary>Columns</summary>
          {columns.map(([k, title]) => (
            <label className="check" key={k}>
              <input
                type="checkbox"
                checked={visible.includes(k)}
                onChange={(e) =>
                  setVisible(
                    e.target.checked
                      ? [...visible, k]
                      : visible.filter((x) => x !== k),
                  )
                }
              />
              {title}
            </label>
          ))}
        </details>
        {editable && (
          <SavedViews
            kind={name}
            onChoose={(c) => {
              setSearch(c.search || "");
              setFilters(c.filters || {});
              setPage(0);
            }}
          />
        )}
        {editable && <button onClick={() => setSaving(true)}>Save view</button>}
        {children}
        <span className="muted">{state.data?.total ?? 0} records</span>
      </div>
      <State {...state}>
        {board ? (
          <div className="kanban">
            {(tableFilters[name]?.[0].values || []).map((stage) => (
              <section className="kanban-column" key={stage}>
                <h3>
                  {label(stage)}{" "}
                  <span>
                    {state.data?.rows.filter((r: Row) => r.stage === stage)
                      .length || 0}
                  </span>
                </h3>
                {state.data?.rows
                  .filter((r: Row) => r.stage === stage)
                  .map((r: Row) => (
                    <article className="kanban-card" key={r.id}>
                      <strong>{r.name || r.business_name || r.code}</strong>
                      <small>{r.code}</small>
                      {r.package_name && (
                        <p>
                          {r.package_name} · {money(r.price_cents)}
                        </p>
                      )}
                      <div className="row-actions">{actions?.(r)}</div>
                    </article>
                  ))}
              </section>
            ))}
          </div>
        ) : (
          <Table
            rows={state.data?.rows || []}
            columns={columns.filter(([k]) => visible.includes(k))}
            actions={actions}
          />
        )}
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} of{" "}
            {Math.max(1, Math.ceil((state.data?.total || 0) / 50))}
            {board ? " · Board shows this page" : ""}
          </span>
          <button
            disabled={(page + 1) * 50 >= (state.data?.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </State>
      {saving && (
        <Modal title="Save this view" onClose={() => setSaving(false)}>
          <Form
            fields={[
              {
                name: "name",
                label: "View name",
                required: true,
                maxLength: 100,
              },
            ]}
            submit="Save view"
            onSubmit={async (p) => {
              await app.mutate("save_view", {
                ...p,
                kind: name,
                config: { search, filters },
                reason: "Save personal filter view",
              });
              setSaving(false);
            }}
          />
        </Modal>
      )}
    </Card>
  );
}
function SavedViews({
  kind,
  onChoose,
}: {
  kind: string;
  onChoose: (config: Row) => void;
}) {
  const state = useData(`/table?name=saved_views&kind=${kind}`);
  return (
    <select
      aria-label="Saved views"
      defaultValue=""
      onChange={(e) => {
        const row = state.data?.rows.find((r: Row) => r.id === e.target.value);
        if (row) onChoose(row.config);
      }}
    >
      <option value="">Saved views</option>
      {state.data?.rows.map((r: Row) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
export const LinkButton = ({
  to,
  children,
  primary = false,
}: {
  to: string;
  children: ReactNode;
  primary?: boolean;
}) => {
  const { navigate } = useApp();
  return (
    <a
      href={to}
      className={primary ? "button primary" : "button"}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
};
