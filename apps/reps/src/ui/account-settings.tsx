import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ShieldCheck, Mail, LogOut } from "lucide-react";
import { authErrorMessage } from "../shared/auth";
import { timezoneOptions } from "../shared/timezones";
import { label, type Row } from "../shared/core";
import {
  Card,
  Form,
  Heading,
  LinkButton,
  Modal,
  State,
  useApp,
  useData,
} from "./lib";
import { XpHistory } from "./accounts";
import { SharedIdentity } from "./profile-identity";
import { MFA } from "./public";

export function Profile() {
  const app = useApp(),
    rep = app.ctx.rep;
  const [user, setUser] = useState<User | null>(null),
    [error, setError] = useState(""),
    [factors, setFactors] = useState<Row[]>([]),
    [security, setSecurity] = useState<"verify" | "enroll" | null>(null),
    [removing, setRemoving] = useState<Row | null>(null),
    [notice, setNotice] = useState("");
  const readiness = useData(rep ? "/report?kind=onboarding" : null, 30000),
    requested = useData("/report?kind=account_email");
  const refresh = async () => {
    const result = await app.client.auth.getUser();
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    setUser(result.data.user);
    const mfa = await app.client.auth.mfa.listFactors();
    if (mfa.error) setError(authErrorMessage(mfa.error));
    else setFactors(mfa.data.totp.filter((f: Row) => f.status === "verified"));
  };
  useEffect(() => {
    void refresh();
  }, [app.version]);
  const pending = user?.new_email || requested.data?.pending_email;
  return (
    <>
      <Heading
        title="My account"
        description="Your identity, sign-in security and workspace preferences."
      />
      <State error={error} />
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {rep && <SharedIdentity rep={rep} surface />}
      <div className="onboarding-grid">
        <Card title="Identity">
          <dl className="account-facts">
            <dt>Display name</dt>
            <dd>{rep?.name || "Administrator"}</dd>
            <dt>Email</dt>
            <dd>
              {user?.email || "Loading…"}
              {user?.email_confirmed_at && (
                <span className="badge">Verified</span>
              )}
            </dd>
            {rep && (
              <>
                <dt>Pixelalty ID</dt>
                <dd>{rep.code}</dd>
              </>
            )}
            <dt>Role</dt>
            <dd>
              {app.ctx.roles.length
                ? app.ctx.roles.map(label).join(", ")
                : "Sales representative"}
            </dd>
            <dt>Account status</dt>
            <dd>{rep ? label(rep.status) : "Administrative account"}</dd>
            {user?.created_at && (
              <>
                <dt>Joined</dt>
                <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
              </>
            )}
            {user?.last_sign_in_at && (
              <>
                <dt>Last sign-in</dt>
                <dd>{new Date(user.last_sign_in_at).toLocaleString()}</dd>
              </>
            )}
          </dl>
        </Card>
        <Card title="Email & verification" extra={<Mail size={20} />}>
          <p>
            Your sign-in address stays <strong>{user?.email}</strong> until the
            email change is verified. Follow the confirmation links sent to your
            inboxes.
          </p>
          {pending && (
            <p className="notice" role="status">
              Verification pending for <strong>{pending}</strong>.{" "}
              {user?.new_email
                ? "Check both your current and new inboxes."
                : "Pixelalty requested this change. Send verification below to confirm it."}
            </p>
          )}
          <Form
            key={pending || user?.email || "email"}
            initial={{ email: pending || "" }}
            fields={[
              {
                name: "email",
                label: "New email address",
                type: "email",
                required: true,
                maxLength: 254,
              },
            ]}
            submit={pending ? "Send verification again" : "Change email"}
            onSubmit={async (p) => {
              if (p.email.trim().toLowerCase() === user?.email?.toLowerCase())
                throw Error("Enter a different email address.");
              const result = await app.client.auth.updateUser(
                { email: p.email.trim() },
                { emailRedirectTo: app.config.appUrl + "/profile" },
              );
              if (result.error) throw Error(authErrorMessage(result.error));
              await refresh();
              setNotice(
                "Email verification requested. Your current address remains active until confirmation is complete.",
              );
            }}
          />
        </Card>
        {rep && (
          <Card title="Profile details">
            <Form
              initial={rep}
              fields={[
                {
                  name: "name",
                  label: "Display name",
                  required: true,
                  minLength: 2,
                  maxLength: 150,
                },
                {
                  name: "timezone",
                  label: "Timezone",
                  required: true,
                  options: timezoneOptions(rep.timezone),
                  hint: "Used for scheduling and your local activity day; it does not establish work eligibility.",
                },
                {
                  name: "bio",
                  label: "About you",
                  type: "textarea",
                  maxLength: 1000,
                },
                {
                  name: "income_goal",
                  label: "Monthly income goal ($)",
                  type: "currency",
                  min: 0,
                  hint: "A personal goal, not a guarantee of earnings.",
                },
              ]}
              submit="Save profile"
              onSubmit={(p) => app.mutate("profile", p)}
            />
            <div className="divider" />
            <LinkButton to="/appearance?tab=profile">
              Edit avatar, frame & banner
            </LinkButton>
          </Card>
        )}
        <Card title="Security" extra={<ShieldCheck size={20} />}>
          <p>
            <strong>Authenticator:</strong>{" "}
            {factors.length ? "Enabled" : "Not enrolled"}
            {app.ctx.roles.length > 0
              ? " · Required for administrative access"
              : ""}
          </p>
          <p>Authenticator codes add a second check when signing in.</p>
          <button
            onClick={() => setSecurity(factors.length ? "verify" : "enroll")}
          >
            {factors.length ? "Verify authenticator" : "Set up authenticator"}
          </button>
          {factors.length > 0 && (
            <>
              <button onClick={() => setSecurity("enroll")}>
                Add another authenticator
              </button>
              <ul className="readiness-list">
                {factors.map((factor) => (
                  <li key={factor.id}>
                    <span>{factor.friendly_name || "Authenticator"}</span>
                    <button
                      disabled={app.ctx.roles.length > 0 && factors.length < 2}
                      onClick={() => setRemoving(factor)}
                    >
                      Remove authenticator
                    </button>
                  </li>
                ))}
              </ul>
              {app.ctx.roles.length > 0 && factors.length < 2 && (
                <p className="muted">
                  Add and verify a replacement before removing your current
                  authenticator. Administrative accounts require MFA.
                </p>
              )}
            </>
          )}
          <div className="divider" />
          <Form
            fields={[
              {
                name: "password",
                label: "New password",
                type: "password",
                required: true,
                minLength: 12,
                autoComplete: "new-password",
              },
            ]}
            submit="Update password"
            onSubmit={async (p) => {
              const result = await app.client.auth.updateUser({
                password: p.password,
              });
              if (result.error) throw Error(authErrorMessage(result.error));
              setNotice("Password updated.");
            }}
          />
          <button
            className="text-button"
            onClick={() =>
              app.run(async () => {
                const result = await app.client.auth.resetPasswordForEmail(
                  user?.email,
                  { redirectTo: app.config.appUrl + "/recover" },
                );
                if (result.error) throw Error(authErrorMessage(result.error));
                setNotice("Password reset instructions sent to your email.");
              })
            }
          >
            Email password reset instructions
          </button>
          <div className="divider" />
          <button
            onClick={() =>
              app.run(async () => {
                const result = await app.client.auth.signOut({
                  scope: "others",
                });
                if (result.error) throw Error(authErrorMessage(result.error));
                setNotice(
                  "Other refresh sessions signed out. Any already-issued access token expires according to the session policy.",
                );
              })
            }
          >
            Sign out other sessions
          </button>
          <button onClick={() => app.client.auth.signOut()}>
            <LogOut size={16} /> Sign out
          </button>
        </Card>
        {rep && (
          <Card title="Account readiness">
            <State {...readiness}>
              <p>
                Complete your steps, then Pixelalty reviews your activation.
              </p>
              <ul className="readiness-list">
                {readiness.data?.steps?.map((s: Row) => (
                  <li key={s.key}>
                    <span>{s.title}</span>
                    <strong>
                      {s.complete
                        ? "Complete"
                        : s.required
                          ? "Pending"
                          : "Optional"}
                    </strong>
                  </li>
                ))}
              </ul>
              <LinkButton to="/onboarding">Review onboarding</LinkButton>
            </State>
          </Card>
        )}
        {rep && (
          <Card title="Goals & calling preferences">
            <Form
              initial={{ shortcuts: true, ...rep.preferences }}
              fields={[
                {
                  name: "sales_goal",
                  label: "Monthly verified sales goal",
                  type: "number",
                  min: 0,
                  max: 10000,
                },
                {
                  name: "calls_goal",
                  label: "Monthly qualifying call goal",
                  type: "number",
                  min: 0,
                  max: 100000,
                },
                {
                  name: "shortcuts",
                  label: "Enable focus keyboard shortcuts",
                  type: "checkbox",
                },
              ]}
              submit="Save preferences"
              onSubmit={(p) => app.mutate("preferences", { value: p })}
            />
          </Card>
        )}
        {rep && <XpHistory compact />}
      </div>
      {security && (
        <Modal title="Authenticator security" onClose={() => setSecurity(null)}>
          <MFA
            client={app.client}
            enrollNew={security === "enroll"}
            onSuccess={() => {
              setSecurity(null);
              void refresh();
              void app.reloadContext();
              setNotice("Authenticator verified.");
            }}
            embedded
          />
        </Modal>
      )}
      {removing && (
        <Modal title="Remove authenticator?" onClose={() => setRemoving(null)}>
          <p>
            This device will no longer provide codes for your account.
            {factors.length === 1
              ? " Removing your only authenticator turns off optional two-step verification."
              : " Your other verified authenticator remains active."}
          </p>
          <Form
            fields={[
              {
                name: "confirm",
                label: "I want to remove this authenticator",
                type: "checkbox",
                required: true,
              },
            ]}
            submit="Confirm removal"
            onSubmit={async (p) => {
              if (!p.confirm) throw Error("Confirm the authenticator removal.");
              const current = await app.client.auth.mfa.listFactors();
              if (current.error) throw Error(authErrorMessage(current.error));
              if (
                app.ctx.roles.length > 0 &&
                  current.data.totp.filter((f: Row) => f.status === "verified")
                  .length < 2
              )
                throw Error(
                  "Verify a replacement authenticator before removing this one.",
                );
              const result = await app.client.auth.mfa.unenroll({
                factorId: removing.id,
              });
              if (result.error) throw Error(authErrorMessage(result.error));
              await app.client.auth.refreshSession();
              setRemoving(null);
              await refresh();
              await app.reloadContext();
              setNotice("Authenticator removed.");
            }}
          />
        </Modal>
      )}
    </>
  );
}
