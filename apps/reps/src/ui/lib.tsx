import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { X, ArrowUpRight, LoaderCircle } from "lucide-react";
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
  const out = (await response.json()) as Row;
  if (!response.ok) throw Error(out.error || "The request failed.");
  return out;
}
export async function download(path: string, filename: string) {
  const session = await auth.auth.getSession();
  const r = await fetch("/api" + path, {
    headers: { Authorization: "Bearer " + session.data.session?.access_token },
  });
  if (!r.ok) throw Error("Download failed.");
  const url = URL.createObjectURL(await r.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export const AppContext = createContext<any>(null);
export const useApp = () => useContext(AppContext);
export function useData(path: string) {
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
  return state;
}
export function State({
  loading,
  error,
  children,
  empty = false,
}: {
  loading?: boolean;
  error?: string;
  children?: ReactNode;
  empty?: boolean;
}) {
  if (loading)
    return (
      <div className="state">
        <LoaderCircle className="spin" /> Loading…
      </div>
    );
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}
      </div>
    );
  if (empty)
    return (
      <div className="state">
        Nothing here yet. New activity will appear here.
      </div>
    );
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
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const el = ref.current;
    el?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const a = Array.from(
          el?.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ) || [],
        ).filter((x) => !x.hasAttribute("disabled"));
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
};
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
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget),
          p: Row = { ...initial };
        for (const f of fields) {
          p[f.name] =
            f.type === "checkbox"
              ? fd.get(f.name) === "on"
              : f.type === "number"
                ? Number(fd.get(f.name))
                : fd.get(f.name);
        }
        setBusy(true);
        setError("");
        try {
          await onSubmit(p);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <label
          className={"field " + (f.type === "checkbox" ? "check" : "")}
          key={f.name}
        >
          <span>{f.label}</span>
          {f.type === "textarea" ? (
            <textarea
              name={f.name}
              defaultValue={initial[f.name] ?? ""}
              required={f.required}
              rows={4}
            />
          ) : f.options ? (
            <select
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
              name={f.name}
              type={f.type || "text"}
              defaultValue={
                f.type === "checkbox" ? undefined : (initial[f.name] ?? "")
              }
              defaultChecked={
                f.type === "checkbox" ? !!initial[f.name] : undefined
              }
              required={f.required}
              min={f.min}
              max={f.max}
            />
          )}
          {f.hint && <small>{f.hint}</small>}
        </label>
      ))}
      {children}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : submit}
      </button>
    </form>
  );
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
          app.notify("Saved.");
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
  const [page, setPage] = useState(0),
    [search, setSearch] = useState("");
  const state = useData(
    `/table?name=${name}&page=${page}${query}${search ? "&q=" + encodeURIComponent(search) : ""}`,
  );
  return (
    <Card>
      <div className="toolbar">
        {["businesses", "reps", "applicants"].includes(name) && (
          <input
            aria-label="Search by name"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        )}
        {children}
        <span className="muted">{state.data?.total ?? 0} records</span>
      </div>
      <State {...state}>
        <Table
          rows={state.data?.rows || []}
          columns={columns}
          actions={actions}
        />
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button
            disabled={(page + 1) * 50 >= (state.data?.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </State>
    </Card>
  );
}
export const LinkButton = ({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) => {
  const { navigate } = useApp();
  return (
    <button onClick={() => navigate(to)}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
};
