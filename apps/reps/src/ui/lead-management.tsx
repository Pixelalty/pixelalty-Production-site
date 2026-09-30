import { useEffect, useState } from "react";
import { ArrowRight, Archive, Trash2 } from "lucide-react";
import {
  useApp,
  useData,
  Heading,
  Card,
  State,
  Table,
  Modal,
  Form,
  ActionDialog,
  download,
} from "./lib";
import { BusinessDetails } from "./details";
import type { Row } from "../shared/core";

export function AvailableLeads({ onClaim }: { onClaim: (id: string) => void }) {
  const app = useApp(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(0),
    [detail, setDetail] = useState<Row | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const state = useData(
    `/report?kind=available_leads&page=${page}&q=${encodeURIComponent(q)}`,
    20000,
  );
  const claim = async (row: Row) => {
    if (busy) return;
    setBusy(row.id);
    setError("");
    try {
      await app.mutate("claim_selected", { id: row.id });
      setDetail(null);
      app.notify(`${row.name} is now in your leads.`);
      onClaim(row.id);
    } catch (cause) {
      setError((cause as Error).message);
      app.refresh();
    } finally {
      setBusy("");
    }
  };
  return (
    <Card title="Available lead pool">
      <p>
        Choose a business you want to work with. Claiming reserves it for you.
      </p>
      <div className="toolbar">
        <label>
          Search available businesses
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Business, industry or city"
          />
        </label>
        <strong>{state.data?.remaining ?? "—"} open lead slots</strong>
      </div>
      {error && <State error={error} />}
      <State {...state}>
        <Table
          rows={state.data?.rows || []}
          columns={[
            ["name", "Business"],
            ["industry", "Industry"],
            ["city", "City"],
            ["state", "State"],
            ["contact", "Ask for"],
            ["phone", "Phone"],
            ["domain", "Website"],
            ["opportunity", "Opportunity"],
          ]}
          actions={(r) => (
            <>
              <button onClick={() => setDetail(r)}>Inspect</button>
              <button
                className="primary"
                disabled={!!busy || state.data?.remaining === 0}
                onClick={() => void claim(r)}
              >
                {busy === r.id ? "Claiming…" : "Claim"}
              </button>
            </>
          )}
        />
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            {state.data?.total || 0} available · Page {page + 1}
          </span>
          <button
            disabled={(page + 1) * 50 >= (state.data?.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </State>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="detail-grid">
            {[
              "industry",
              "city",
              "state",
              "timezone",
              "contact",
              "phone",
              "domain",
              "description",
              "services",
              "opportunity",
            ].map((key) => (
              <div key={key}>
                <small>{key}</small>
                <p>{detail[key] || "Not provided"}</p>
              </div>
            ))}
          </div>
          <button
            className="primary"
            disabled={!!busy || state.data?.remaining === 0}
            onClick={() => void claim(detail)}
          >
            Claim this lead <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </Card>
  );
}
export function LeadManagement() {
  const app = useApp(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<string | null>(null),
    [override, setOverride] = useState<Row | null>(null),
    [operation, setOperation] = useState<{
      type: "delete" | "archive";
      ids: string[];
      requestId: string;
    } | null>(null),
    [receipt, setReceipt] = useState<Row | null>(null);
  const state = useData(
      `/table?name=businesses&page=${page}&archived=${archived}&q=${encodeURIComponent(q)}`,
    ),
    rows: Row[] = state.data?.rows || [];
  useEffect(() => setSelected([]), [q, archived]);
  const choose = (id: string, checked: boolean) =>
    setSelected((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id),
    );
  const open = (type: "delete" | "archive", ids = selected) =>
    setOperation({ type, ids, requestId: crypto.randomUUID() });
  return (
    <>
      <Heading
        title="Business database"
        description="Manage the shared lead pool and keep the CRM clean."
      >
        <button
          onClick={() =>
            app.run(() =>
              download("/export/businesses", "pixelalty-businesses.csv"),
            )
          }
        >
          Export businesses
        </button>
      </Heading>
      <Card>
        <div className="toolbar">
          <label>
            Search businesses
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            View
            <select
              value={String(archived)}
              onChange={(e) => {
                setArchived(e.target.value === "true");
                setPage(0);
              }}
            >
              <option value="false">Current leads</option>
              <option value="true">Archived leads</option>
            </select>
          </label>
        </div>
        <div className="bulk-toolbar">
          <label>
            <input
              type="checkbox"
              checked={
                rows.length > 0 && rows.every((r) => selected.includes(r.id))
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...new Set([...selected, ...rows.map((r) => r.id)])]
                    : selected.filter((id) => !rows.some((r) => r.id === id)),
                )
              }
            />{" "}
            Select all {rows.length} on this page
          </label>
          <strong>{selected.length} selected</strong>
          <button disabled={!selected.length} onClick={() => open("archive")}>
            <Archive size={15} /> Archive selected
          </button>
          <button
            className="danger"
            disabled={!selected.length}
            onClick={() => open("delete")}
          >
            <Trash2 size={15} /> Delete permanently
          </button>
          <button disabled={!selected.length} onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
        {receipt && (
          <p className="notice" role="status">
            {receipt.deleted} permanently deleted · {receipt.protected} removed
            from the CRM with required evidence preserved · {receipt.archived}{" "}
            archived · {receipt.already_removed} already removed ·{" "}
            {receipt.failed} failed.
          </p>
        )}
        <State {...state}>
          <Table
            rows={rows}
            columns={[
              ["selected", "Select"],
              ["name", "Business"],
              ["phone", "Phone"],
              ["city", "City"],
              ["stage", "Stage"],
              ["source", "Source"],
            ]}
            render={{
              selected: (r) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name}`}
                  checked={selected.includes(r.id)}
                  onChange={(e) => choose(r.id, e.target.checked)}
                />
              ),
            }}
            actions={(r) => (
              <>
                <button onClick={() => setDetail(r.id)}>Details</button>
                <button onClick={() => open("archive", [r.id])}>Archive</button>
                <button onClick={() => open("delete", [r.id])}>
                  Delete permanently
                </button>
                <details>
                  <summary>Ownership override</summary>
                  <button onClick={() => setOverride(r)}>
                    Assign to active rep
                  </button>
                  {r.owner_id && !r.customer && (
                    <button
                      onClick={() =>
                        app.run(() =>
                          app.mutate("lead_release", {
                            id: r.id,
                            reason:
                              "Administrator released lead to shared pool",
                          }),
                        )
                      }
                    >
                      Release to pool
                    </button>
                  )}
                </details>
              </>
            )}
          />
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              {state.data?.total || 0} businesses · Page {page + 1}
            </span>
            <button
              disabled={(page + 1) * 50 >= (state.data?.total || 0)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </State>
      </Card>
      {detail && (
        <BusinessDetails id={detail} onClose={() => setDetail(null)} />
      )}
      {override && (
        <ActionDialog
          title="Administrative ownership override"
          action="assign"
          initial={override}
          fields={[
            {
              name: "rep_id",
              label: "Active rep",
              required: true,
              searchTable: "reps",
              searchQuery: "&status=active",
            },
          ]}
          onClose={() => setOverride(null)}
        />
      )}
      {operation && (
        <Modal
          title={
            operation.type === "delete"
              ? `Permanently delete ${operation.ids.length} leads?`
              : `Archive ${operation.ids.length} leads?`
          }
          onClose={() => setOperation(null)}
        >
          <p>
            {operation.type === "delete"
              ? "This cannot be undone. Ordinary lead records and spreadsheet copies will be permanently removed. Required sale, recording, financial or compliance evidence stays protected, with the business removed from the operational CRM."
              : "These leads will leave the shared pool and current assignments. Their history remains available in Archived leads."}
          </p>
          <Form
            fields={[
              { name: "reason", label: "Reason", required: true, minLength: 3 },
              ...(operation.type === "delete"
                ? [
                    {
                      name: "confirmation",
                      label: `Type DELETE ${operation.ids.length} LEADS`,
                      required: true,
                    },
                  ]
                : []),
            ]}
            submit={
              operation.type === "delete"
                ? "Confirm permanent deletion"
                : "Archive leads"
            }
            onSubmit={async (p) => {
              const result = await app.mutate(
                operation.type === "delete" ? "leads_delete" : "leads_archive",
                { ...p, ids: operation.ids, request_id: operation.requestId },
              );
              setReceipt(result);
              setSelected([]);
              setOperation(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
