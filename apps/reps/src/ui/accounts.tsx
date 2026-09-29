import { useState } from "react";
import {
  api,
  useApp,
  useData,
  Heading,
  Card,
  State,
  Modal,
  Form,
  ActionDialog,
  LinkButton,
  Table,
  type Field,
} from "./lib";
import { label, type Row } from "../shared/core";
import { careerProgress } from "../shared/progression";
import { SharedIdentity } from "./profile-identity";
import { timezoneOptions } from "../shared/timezones";
import { SalesCode } from "./payouts";

type AccountDialog = {
  title: string;
  action: string;
  initial: Row;
  fields?: Field[];
  endpoint?: string;
};
export function LoginAccounts() {
  const app = useApp(),
    state = useData("/report?kind=login_accounts"),
    [target, setTarget] = useState<Row | null>(null),
    [dialog, setDialog] = useState<AccountDialog | null>(null);
  return (
    <Card title="Accounts without a rep profile">
      <p>
        Administrative and pending logins are managed here. The final Owner must
        transfer ownership before deletion.
      </p>
      <State {...state}>
        <Table
          rows={(state.data || []).map((r: Row) => ({
            ...r,
            role_names:
              r.roles.map(label).join(", ") || "No administrative role",
          }))}
          columns={[
            ["email", "Email"],
            ["role_names", "Roles"],
          ]}
          actions={(r: Row) => (
            <div className="actions">
              <button
                onClick={() =>
                  setDialog({
                    title: "Revoke sessions",
                    action: "account_revoke",
                    initial: { id: r.id },
                  })
                }
              >
                Revoke sessions
              </button>
              <button
                onClick={() =>
                  setDialog({
                    title: "Manage role",
                    action: "role",
                    initial: { id: r.id },
                    fields: [
                      {
                        name: "role",
                        label: "Role",
                        required: true,
                        options: [
                          "owner",
                          "sales_admin",
                          "finance_admin",
                          "compliance_admin",
                          "content_admin",
                          "manager",
                          "support",
                        ].map((value) => ({ value, label: label(value) })),
                      },
                      {
                        name: "enabled",
                        label: "Grant this role",
                        type: "checkbox",
                      },
                    ],
                  })
                }
              >
                Manage role
              </button>
              <button className="danger" onClick={() => setTarget(r)}>
                Delete account
              </button>
            </div>
          )}
        />
      </State>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
      {target && (
        <Modal title="Delete login account" onClose={() => setTarget(null)}>
          <p>
            <strong>{target.name}</strong>
            <br />
            {target.email}
            <br />
            Rep ID: No rep profile
            <br />
            Account reference: {target.id}
          </p>
          <p>
            Login and sessions will be removed permanently. Required audit and
            accounting records remain attached to an archived identity.
          </p>
          <Form
            fields={[
              {
                name: "confirmation",
                label: "Type DELETE " + target.code,
                required: true,
              },
              {
                name: "reason",
                label: "Reason for deletion",
                type: "textarea",
                minLength: 5,
                required: true,
              },
            ]}
            submit="Delete account permanently"
            onSubmit={async (p) => {
              await api("/account/delete", { ...p, id: target.id });
              setTarget(null);
              app.refresh();
              app.notify("ACCOUNT DELETED. Required audit history retained.");
            }}
          />
        </Modal>
      )}
    </Card>
  );
}
export function XpHistory({
  repId,
  compact = false,
}: {
  repId?: string;
  compact?: boolean;
}) {
  const [page, setPage] = useState(0),
    state = useData(
      `/report?kind=xp_history&page=${page}${repId ? `&id=${repId}` : ""}`,
      15000,
    ),
    app = useApp(),
    progress = careerProgress(
      state.data?.total || 0,
      app.ctx.settings?.xp_per_level,
    );
  return (
    <Card title="Career XP history">
      <State {...state}>
        <p>
          <strong>
            {Number(state.data?.total || 0).toLocaleString()} career XP
          </strong>{" "}
          · Every award and correction is recorded.
        </p>
        <p aria-live="polite">
          Level {progress.level.toLocaleString()} ·{" "}
          {progress.within.toLocaleString()} / {progress.step.toLocaleString()}{" "}
          XP within this level
        </p>
        <progress
          aria-label="Career level progress"
          value={progress.within}
          max={progress.step}
        />
        <p className="fine-print">
          The bar starts again at each level.{" "}
          {progress.remaining.toLocaleString()} XP to the next level.
        </p>
        {!compact && (
          <>
            <Table
              rows={(state.data?.rows || []).map((r: Row) => ({
                ...r,
                event: label(r.event || r.source),
                amount_display: (r.amount > 0 ? "+" : "") + r.amount,
                source: label(r.source),
              }))}
              columns={[
                ["created_at", "Date"],
                ["event", "Event"],
                ["amount_display", "Amount"],
                ["source", "Source"],
                ["running_total", "Running total"],
                ["reason", "Correction reason"],
              ]}
            />
            <div className="pager">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous XP events
              </button>
              <span>Page {page + 1}</span>
              <button
                disabled={(page + 1) * 50 >= (state.data?.count || 0)}
                onClick={() => setPage(page + 1)}
              >
                Next XP events
              </button>
            </div>
          </>
        )}
        {compact && <LinkButton to="/xp">View XP history</LinkButton>}
        {!compact && (
          <p className="notice">
            Manual call outcomes are self-reported. A phone-button click earns
            no XP and cannot prove a conversation. The server checks lead
            ownership, unique submissions, a 30-second qualification cooldown,
            one qualification per lead in 24 hours, and your local-day XP cap.
            Paid-sale awards require verified payment events.
          </p>
        )}
      </State>
    </Card>
  );
}
export function ManageAccount({ code }: { code: string }) {
  const app = useApp(),
    state = useData("/report?kind=account&code=" + encodeURIComponent(code)),
    d = state.data,
    [dialog, setDialog] = useState<AccountDialog | null>(null),
    [deleting, setDeleting] = useState<"delete" | "purge" | null>(null);
  const r = d?.rep;
  const show = (
    title: string,
    action: string,
    fields: Field[] = [],
    endpoint?: string,
    initial: Row = {},
  ) =>
    setDialog({
      title,
      action,
      fields,
      endpoint,
      initial: { id: r.id, ...initial },
    });
  return (
    <>
      <Heading
        title={r ? `Manage ${r.name}` : "Manage account"}
        description="Changes are recorded with a reason. Onboarding and financial readiness remain tied to verified evidence."
      >
        <LinkButton to="/admin/reps">All reps</LinkButton>
      </Heading>
      <State {...state}>
        {r && (
          <>
            <div className="card-head">
              <strong>{r.code}</strong>
              <span>{r.deleted_at ? "ACCOUNT DELETED" : label(r.status)}</span>
            </div>
            {r.deleted_at && (
              <Card title="ACCOUNT DELETED">
                <p>
                  {d.deletion?.status === "complete"
                    ? "Protected historical records retained for accounting/audit integrity."
                    : "Portal access has been revoked. Finish the pending deletion to remove authentication and clean up this account."}
                </p>
              </Card>
            )}
            {!r.deleted_at && <SharedIdentity rep={r} surface />}
            {!r.deleted_at && (
              <div className="onboarding-grid">
                <Card title="Profile & responsibilities">
                  <Form
                    key={r.id}
                    initial={{
                      ...r,
                      ...d.private,
                      ...r.preferences,
                      team_id: r.team_id || "",
                    }}
                    fields={[
                      {
                        name: "name",
                        label: "Display name",
                        required: true,
                        maxLength: 150,
                      },
                      {
                        name: "legal_name",
                        label: "Legal / admin name",
                        maxLength: 150,
                      },
                      {
                        name: "timezone",
                        label: "Timezone",
                        required: true,
                        options: timezoneOptions(r.timezone),
                      },
                      {
                        name: "bio",
                        label: "Visible profile information",
                        type: "textarea",
                        maxLength: 2000,
                      },
                      {
                        name: "capacity",
                        label: "Lead capacity",
                        type: "number",
                        min: 1,
                        max: 100,
                        required: true,
                      },
                      {
                        name: "team_id",
                        label: "Team",
                        options: [
                          { value: "", label: "No team" },
                          ...(d.teams || []),
                        ],
                      },
                      {
                        name: "tier",
                        label: "Tier",
                        options: [
                          { value: "standard", label: "Standard" },
                          { value: "senior", label: "Senior" },
                          { value: "lead", label: "Lead" },
                        ],
                      },
                      {
                        name: "income_goal",
                        label: "Monthly income goal ($)",
                        type: "currency",
                        min: 0,
                      },
                      {
                        name: "sales_goal",
                        label: "Monthly sales goal",
                        type: "number",
                        min: 0,
                        max: 10000,
                      },
                      {
                        name: "calls_goal",
                        label: "Monthly call goal",
                        type: "number",
                        min: 0,
                        max: 100000,
                      },
                      {
                        name: "reason",
                        label: "Reason for this change",
                        type: "textarea",
                        minLength: 5,
                        required: true,
                      },
                    ]}
                    submit="Save account changes"
                    onSubmit={async (p) => {
                      await app.mutate("account_edit", { ...p, id: r.id });
                      app.notify("Account changes saved.");
                    }}
                  />
                </Card>
                <div>
                  <SalesCode repId={r.id} manage />
                  {(app.has("sales_admin") || app.has("support")) && (
                    <Card title="Profile moderation">
                      <p>
                        Remove inappropriate profile images and restore the
                        standard presets. This does not change earned unlocks.
                      </p>
                      <Form
                        fields={[
                          {
                            name: "reason",
                            label: "Reason for removal",
                            type: "textarea",
                            required: true,
                            minLength: 5,
                          },
                        ]}
                        submit="Remove profile images & reset style"
                        onSubmit={async (p) => {
                          await api("/profile/moderate", {
                            rep_id: r.id,
                            reason: p.reason,
                          });
                          app.refresh();
                          app.notify("Profile reset and images removed.");
                        }}
                      />
                    </Card>
                  )}
                  <Card title="Onboarding & readiness">
                    <p>
                      Classification, agreements, tax review and payout
                      readiness are managed through their approval workflows.
                    </p>
                    <LinkButton to={"/admin/reps?rep_code=" + r.code}>
                      Review onboarding & activation
                    </LinkButton>
                    <LinkButton to="/admin/tax">Tax review</LinkButton>
                    {app.has("finance_admin") && (
                      <LinkButton to="/admin/finance/payout-setup">
                        Review payout setup
                      </LinkButton>
                    )}
                  </Card>
                  <Card title="Access & account security">
                    <p>{d.private?.email}</p>
                    {d.pending_email && (
                      <p>Pending email change: {d.pending_email}</p>
                    )}
                    <p>
                      Roles:{" "}
                      {d.roles?.length
                        ? d.roles.map(label).join(", ")
                        : "Representative"}
                    </p>
                    <div className="actions">
                      <button
                        onClick={() => show("Suspend account", "rep_suspend")}
                      >
                        Suspend account
                      </button>
                      <button
                        onClick={() =>
                          show(
                            "Release assigned leads",
                            "account_release_leads",
                          )
                        }
                      >
                        Release assigned leads
                      </button>
                      {app.has("owner") && (
                        <>
                          <button
                            onClick={() =>
                              show(
                                "Request email change",
                                "account_email_request",
                                [
                                  {
                                    name: "email",
                                    label: "New email",
                                    type: "email",
                                    required: true,
                                  },
                                ],
                              )
                            }
                          >
                            Request email change
                          </button>
                          <button
                            onClick={() =>
                              show("Manage role", "role", [
                                {
                                  name: "role",
                                  label: "Role",
                                  required: true,
                                  options: [
                                    "owner",
                                    "sales_admin",
                                    "manager",
                                    "finance_admin",
                                    "compliance_admin",
                                    "content_admin",
                                    "support",
                                  ].map((v) => ({ value: v, label: label(v) })),
                                },
                                {
                                  name: "enabled",
                                  label: "Grant this role",
                                  type: "checkbox",
                                },
                              ])
                            }
                          >
                            Manage role
                          </button>
                          <button
                            onClick={() =>
                              show("Revoke sessions", "account_revoke")
                            }
                          >
                            Revoke sessions
                          </button>
                          <button
                            onClick={() =>
                              show(
                                "Send reset email & revoke sessions",
                                "",
                                [],
                                "/account/reset-password",
                              )
                            }
                          >
                            Send password reset
                          </button>
                          <button
                            onClick={() =>
                              show(
                                "Update access options",
                                "account_access_options",
                                [
                                  {
                                    name: "leaderboard",
                                    label: "Leaderboard access",
                                    type: "checkbox",
                                  },
                                  {
                                    name: "profile_frames",
                                    label: "Unlock profile frames",
                                    type: "checkbox",
                                  },
                                ],
                                undefined,
                                {
                                  leaderboard:
                                    d.private?.access_overrides?.leaderboard !==
                                    false,
                                  profile_frames:
                                    d.private?.access_overrides
                                      ?.profile_frames === true,
                                },
                              )
                            }
                          >
                            Feature access & unlocks
                          </button>
                        </>
                      )}
                    </div>
                  </Card>
                  <Card title="Progress corrections">
                    <p>
                      Corrections add ledger entries. Payment and commission
                      records cannot be overwritten.
                    </p>
                    <button
                      onClick={() =>
                        show(
                          "Adjust XP",
                          "xp_adjust",
                          [
                            {
                              name: "amount",
                              label: "XP adjustment (+ or −)",
                              type: "number",
                              required: true,
                              min: -1000000,
                              max: 1000000,
                            },
                          ],
                          undefined,
                          { request_id: crypto.randomUUID() },
                        )
                      }
                    >
                      Adjust XP
                    </button>
                    <button
                      onClick={() =>
                        show(
                          "Correct progression",
                          "progression_adjust",
                          [
                            {
                              name: "kind",
                              label: "Correction",
                              options: [
                                { value: "streak", label: "Streak days" },
                                { value: "freeze", label: "Freeze allocation" },
                                { value: "achievement", label: "Achievement" },
                              ],
                            },
                            {
                              name: "amount",
                              label: "Adjustment (+ or −; achievement 1 or −1)",
                              type: "number",
                              required: true,
                            },
                            {
                              name: "achievement",
                              label: "Achievement",
                              options: [
                                { value: "first_call", label: "First call" },
                                {
                                  value: "first_sale",
                                  label: "First verified sale",
                                },
                                {
                                  value: "trained",
                                  label: "Required training complete",
                                },
                              ],
                            },
                          ],
                          undefined,
                          { request_id: crypto.randomUUID() },
                        )
                      }
                    >
                      Correct streak or achievement
                    </button>
                  </Card>
                </div>
              </div>
            )}
            <XpHistory repId={r.id} />
            {app.has("owner") && d.deletion?.status !== "complete" && (
              <Card title="Delete account">
                <p>
                  Login and sessions are revoked immediately. Required
                  accounting, legal and tax history is preserved under an
                  archived identity. Accounts without protected history are
                  purged.
                </p>
                <div className="actions">
                  <button
                    className="danger"
                    onClick={() => setDeleting("delete")}
                  >
                    {r.deleted_at
                      ? "Finish account deletion"
                      : "Delete account"}
                  </button>
                  <button
                    disabled={d.protected_history}
                    onClick={() => setDeleting("purge")}
                  >
                    Purge test data
                  </button>
                </div>
                {d.protected_history && (
                  <p className="muted">
                    This account has protected history. Delete Account remains
                    available.
                  </p>
                )}
              </Card>
            )}
          </>
        )}
      </State>
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
      {deleting && r && (
        <Modal
          title={
            deleting === "purge"
              ? "Permanently purge test data"
              : "Delete account"
          }
          onClose={() => setDeleting(null)}
        >
          <p>
            <strong>{r.name}</strong>
            <br />
            {r.code}
            <br />
            {d.private?.email || "Email removed"}
          </p>
          <p>
            This permanently removes access.{" "}
            {d.protected_history
              ? "Protected historical records will be retained."
              : "Disposable account data will be permanently removed."}
          </p>
          <Form
            fields={[
              {
                name: "confirmation",
                label: `Type ${deleting === "purge" ? "PURGE TEST DATA" : "DELETE"} ${r.code}`,
                required: true,
              },
              {
                name: "reason",
                label: "Reason for deletion",
                type: "textarea",
                required: true,
                minLength: 5,
              },
            ]}
            submit={
              deleting === "purge"
                ? "Permanently purge test data"
                : "Delete account permanently"
            }
            onSubmit={async (p) => {
              const result = await api("/account/delete", {
                ...p,
                id: r.id,
                purge: deleting === "purge",
              });
              setDeleting(null);
              app.refresh();
              app.notify(
                result.mode === "retain"
                  ? "ACCOUNT DELETED — Protected historical records retained for accounting/audit integrity."
                  : "Account and disposable data permanently deleted.",
              );
              if (result.mode === "purge") app.navigate("/admin/reps");
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function StripeHealth() {
  const state = useData("/stripe/health"),
    d = state.data;
  return (
    <Card title="Stripe connection & deliveries">
      <State {...state}>
        {d && (
          <>
            {[
              ["Platform API", d.platform_api],
              ["Connected Stripe account", d.platform_account],
              ["Mode", d.mode],
              ["Platform endpoint", d.platform_destination],
              ["Connect endpoint", d.connect_destination],
              [
                "Separate signing secrets",
                d.separate_signatures ? "Configured" : "Needs attention",
              ],
              ["Connected reps", d.connected_reps],
              ["Incomplete onboarding", d.incomplete],
              ["Failed events", d.failed_events],
              ["Unattributed events", d.unattributed_events],
              ["Payments", d.payments],
              ["Commissions", d.commissions],
            ].map(([name, value]) => (
              <div className="health-row" key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
            {d.category && (
              <p className="notice error">Diagnostic category: {d.category}</p>
            )}
            {["platform", "connect"].map((channel) => {
              const e = d.deliveries.find((x: Row) => x.channel === channel);
              return (
                <div className="health-row" key={channel}>
                  <span>{label(channel)} webhook · last delivery</span>
                  <strong>
                    {e
                      ? `${label(e.status)} · ${new Date(e.delivered_at).toLocaleString()}`
                      : "No delivery verified"}
                  </strong>
                </div>
              );
            })}
            <p className="muted">
              A configured endpoint does not prove delivery. Unattributed events
              need Finance review and do not block valid new onboarding.
            </p>
          </>
        )}
      </State>
    </Card>
  );
}
