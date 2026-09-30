import { useState } from "react";
import { useData, Heading, Card, State, Table, LinkButton } from "./lib";
import { label } from "../shared/core";
export function DeletedAccounts({ id }: { id?: string | null }) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(0);
  const state = useData(
    id
      ? `/report?kind=deleted_account&id=${encodeURIComponent(id)}`
      : `/report?kind=deleted_accounts&q=${encodeURIComponent(q)}&page=${page}`,
  );
  return (
    <>
      <Heading
        title={id ? "Historical account record" : "Deleted accounts"}
        description="Access is permanently removed. Required sales, payout and audit evidence remains protected."
      >
        <LinkButton to={id ? "/admin/reps/deleted" : "/admin/reps"}>
          {id ? "All deleted accounts" : "Rep management"}
        </LinkButton>
      </Heading>
      {!id && (
        <Card>
          <label>
            Search historical accounts
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <State {...state}>
            <Table
              rows={state.data?.rows || []}
              columns={[
                ["code", "Former rep"],
                ["name", "Former name"],
                ["email", "Former email"],
                ["deleted_at", "Deletion date"],
                ["deleted_by", "Deleted by"],
                ["status", "Status"],
              ]}
              actions={(r) => (
                <LinkButton to={`/admin/reps/deleted?id=${r.id}`}>
                  Historical records
                </LinkButton>
              )}
            />
            <div className="pagination">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {state.data?.total || 0} records · Page {page + 1}
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
      )}
      {id && (
        <State {...state}>
          {state.data && (
            <>
              <Card title={state.data.account.former_name || "Deleted account"}>
                <dl className="detail-grid">
                  {[
                    "account_code",
                    "former_email",
                    "created_at",
                    "completed_at",
                    "actor_id",
                    "status",
                    "mode",
                    "reason",
                  ].map((k) => (
                    <div key={k}>
                      <dt>{label(k)}</dt>
                      <dd>{state.data.account[k] || "Not retained"}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <p>
                Historical references below are read-only. Up to 100 recent
                records per category are shown; the full accounting and audit
                ledgers remain available.
              </p>
              {(
                [
                  [
                    "sales",
                    [
                      ["id", "Sale"],
                      ["package_name", "Package"],
                      ["amount_cents", "Paid"],
                      ["paid_at", "Date"],
                    ],
                  ],
                  [
                    "commissions",
                    [
                      ["id", "Commission"],
                      ["amount_cents", "Amount"],
                      ["status", "Status"],
                    ],
                  ],
                  [
                    "payouts",
                    [
                      ["id", "Payout"],
                      ["amount_cents", "Amount"],
                      ["paid_at", "Paid"],
                    ],
                  ],
                  [
                    "deals",
                    [
                      ["code", "Deal"],
                      ["package_name", "Package"],
                      ["price_cents", "Amount"],
                      ["stage", "Stage"],
                    ],
                  ],
                  [
                    "calls",
                    [
                      ["id", "Call reference"],
                      ["business_id", "Business reference"],
                      ["outcome", "Outcome"],
                      ["created_at", "Recorded"],
                    ],
                  ],
                  [
                    "recordings",
                    [
                      ["title", "Recording"],
                      ["id", "Reference"],
                      ["status", "Status"],
                      ["recorded_at", "Recorded"],
                    ],
                  ],
                  [
                    "audit",
                    [
                      ["action", "Action"],
                      ["reason", "Reason"],
                      ["actor_id", "Actor"],
                      ["created_at", "Time"],
                    ],
                  ],
                ] as [string, [string, string][]][]
              ).map(([key, columns]) => (
                <Card title={label(key)} key={key}>
                  <Table rows={state.data[key]} columns={columns} />
                </Card>
              ))}
            </>
          )}
        </State>
      )}
    </>
  );
}

export function RepSummary({ code }: { code: string }) {
  const state = useData(
    `/report?kind=rep_summary&code=${encodeURIComponent(code)}`,
  );
  return (
    <>
      <Heading title="Rep account">
        <LinkButton to="/admin/reps">Rep management</LinkButton>
      </Heading>
      <State {...state}>
        {state.data?.rep && (
          <Card title={state.data.rep.name}>
            <dl className="detail-grid">
              {["code", "email", "status"].map((key) => (
                <div key={key}>
                  <dt>{label(key)}</dt>
                  <dd>{state.data.rep[key] || "Not provided"}</dd>
                </div>
              ))}
            </dl>
            <p>
              Account changes are managed by Sales administration. Financial and
              support records stay in their respective workspaces.
            </p>
          </Card>
        )}
      </State>
    </>
  );
}
