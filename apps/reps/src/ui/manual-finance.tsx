import { useState } from "react";
import {
  Card,
  Form,
  LinkButton,
  Listing,
  Modal,
  State,
  Table,
  useApp,
  useData,
} from "./lib";
import { money, type Row } from "../shared/core";

export function ManualFinance() {
  const [hold, setHold] = useState<Row | null>(null);
  const app = useApp(),
    [page, setPage] = useState(0),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<Row[]>([]),
    [confirm, setConfirm] = useState(false),
    [requestId, setRequestId] = useState("");
  const state = useData(
      `/report?kind=manual_finance&page=${page}&status=${status}`,
    ),
    total = selected.reduce((sum, c) => sum + c.amount_cents, 0);
  return (
    <div className="manual-finance">
      <div className="actions">
        <LinkButton to="/admin/finance/payout-setup">
          Review payout setup
        </LinkButton>
        <LinkButton to="/admin/reps">Assign rep sales codes</LinkButton>
      </div>
      <Card title="Weekly amounts owed">
        <p>
          Amounts below are payable commissions, not proof that money was sent.
          Review eligibility, send the actual payout in Stripe Global Payouts in
          your own browser, then record it here.
        </p>
        <State
          {...state}
          empty={!state.data?.weekly?.length}
          emptyText="No payable commissions yet."
        >
          <Table
            rows={(state.data?.weekly || []).map((r: Row) => ({
              ...r,
              setup: r.payout_ready
                ? "Payout setup approved"
                : "Payout setup not approved",
            }))}
            columns={[
              ["name", "Rep"],
              ["code", "Rep ID"],
              ["commissions", "Commissions"],
              ["amount_cents", "Amount owed"],
              ["setup", "Payout setup"],
            ]}
          />
        </State>
      </Card>
      <Card title="Commission ledger">
        <p>
          Pending commissions stay held until the hold period and settlement
          checks pass. Paid entries and refund/dispute adjustments retain their
          history.
        </p>
        <div className="field finance-filter">
          <label htmlFor="commission-filter">Status</label>
          <select
            id="commission-filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
              setSelected([]);
            }}
          >
            <option value="all">All</option>
            <option value="hold">Pending / Held</option>
            <option value="payable">Payable</option>
            <option value="paid">Paid</option>
            <option value="recovery_review">Adjustment required</option>
          </select>
        </div>
        <State
          {...state}
          empty={!state.data?.rows?.length}
          emptyText="Verified attributed customer payments will appear here."
        >
          <Table
            rows={(state.data?.rows || []).map((r: Row) => ({
              ...r,
              hold_until_at: r.hold_until,
              eligibility: r.eligible
                ? "Ready for payment"
                : r.status === "payable"
                  ? "Review payout/tax setup"
                  : "Not payable",
            }))}
            columns={[
              ["rep_name", "Rep"],
              ["rep_code", "Rep ID"],
              ["package_name", "Package"],
              ["sale_cents", "Customer paid"],
              ["amount_cents", "Fixed commission"],
              ["status", "Status"],
              ["hold_until_at", "Hold until"],
              ["eligibility", "Eligibility"],
            ]}
            actions={(r) => (
              <div className="actions">
                {r.eligible && (
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.rep_name} ${r.package_name} commission ${r.id}`}
                      checked={selected.some((x) => x.id === r.id)}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked
                            ? [...current, r]
                            : current.filter((x) => x.id !== r.id),
                        )
                      }
                    />{" "}
                    Select
                  </label>
                )}
                {["hold", "payable"].includes(r.status) && (
                  <button onClick={() => setHold(r)}>
                    {r.manual_hold ? "Release hold" : "Hold"}
                  </button>
                )}
              </div>
            )}
          />
        </State>
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button
            disabled={(page + 1) * 50 >= (state.data?.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
        <div className="actions">
          <strong>
            {selected.length} selected · {money(total)}
          </strong>
          <button
            className="primary"
            disabled={
              !selected.length ||
              new Set(selected.map((x) => x.rep_id)).size !== 1
            }
            onClick={() => {
              setRequestId(crypto.randomUUID());
              setConfirm(true);
            }}
          >
            Mark Paid
          </button>
          <button disabled={!selected.length} onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
        {new Set(selected.map((x) => x.rep_id)).size > 1 && (
          <p role="status">Select commissions for one rep per payout.</p>
        )}
      </Card>
      <Card title="Confirmed manual payouts">
        <Listing
          name="manual_payouts"
          columns={[
            ["amount_cents", "Amount"],
            ["paid_at", "Payment date"],
            ["stripe_reference", "Stripe reference"],
            ["note", "Admin note"],
            ["created_at", "Recorded"],
          ]}
        />
      </Card>
      <Card title="Verified customer sales">
        <p>
          Unassigned, direct, and mismatched-code purchases remain visible
          without generating a rep commission.
        </p>
        <Listing
          name="verified_sales"
          columns={[
            ["package_name", "Package"],
            ["promotion_code", "Code used"],
            ["attribution", "Attribution"],
            ["amount_cents", "Customer paid"],
            ["commission_cents", "Commission"],
            ["paid_at", "Paid"],
          ]}
        />
      </Card>
      {hold && (
        <Modal
          title={
            hold.manual_hold ? "Release commission hold" : "Hold commission"
          }
          onClose={() => setHold(null)}
        >
          <p>
            {hold.rep_name} · {money(hold.amount_cents)}
          </p>
          <Form
            fields={[
              {
                name: "reason",
                label: "Audit reason",
                type: "textarea",
                required: true,
                minLength: 5,
                maxLength: 500,
              },
            ]}
            submit={hold.manual_hold ? "Release hold" : "Hold commission"}
            onSubmit={async (p) => {
              await app.mutate(
                hold.manual_hold ? "commission_release" : "commission_hold",
                { id: hold.id, ...p },
              );
              setHold(null);
              setSelected([]);
            }}
          />
        </Modal>
      )}
      {confirm && (
        <Modal
          title="Confirm payout was paid"
          onClose={() => setConfirm(false)}
        >
          <p>
            <strong>
              {selected[0]?.rep_name} · {money(total)}
            </strong>
          </p>
          <p>
            This does not send money. Only confirm after you have actually sent
            this payout in Stripe. Payment history cannot be silently rewritten.
          </p>
          <Form
            fields={[
              {
                name: "paid_at",
                label: "Actual payment date and time",
                type: "datetime-local",
                required: true,
              },
              {
                name: "stripe_reference",
                label: "Stripe payout reference (optional)",
                pattern: "(op|obp|po|poi|payout|outbound)_[A-Za-z0-9_]{3,100}",
                maxLength: 110,
                hint: "Non-secret reference only. Never enter banking data.",
              },
              {
                name: "note",
                label: "Admin note (optional; no sensitive information)",
                type: "textarea",
                maxLength: 500,
              },
              {
                name: "confirmed",
                label: `I confirm I actually sent ${money(total)} to ${selected[0]?.rep_name} through Stripe.`,
                type: "checkbox",
                required: true,
              },
            ]}
            submit={`Confirm ${money(total)} paid`}
            onSubmit={async (p) => {
              await app.mutate("manual_mark_paid", {
                ...p,
                paid_at: new Date(p.paid_at).toISOString(),
                request_id: requestId,
                amount_cents: total,
                commission_ids: selected.map((x) => x.id),
              });
              setConfirm(false);
              setSelected([]);
              app.notify(
                "Actual payout recorded. No money was sent by Pixelalty.",
              );
            }}
          />
        </Modal>
      )}
    </div>
  );
}
