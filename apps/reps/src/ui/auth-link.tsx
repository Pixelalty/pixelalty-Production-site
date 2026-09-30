import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ShieldCheck, Link2Off } from "lucide-react";
import { AuthShell } from "./auth-shell";
import type { AuthLink } from "../shared/auth";
import { authErrorMessage } from "../shared/auth";

export function InvalidAuthLink({ invite = true }: { invite?: boolean }) {
  return (
    <AuthShell>
      <Link2Off size={34} />
      <h1>
        {invite
          ? "This invitation is no longer valid"
          : "This link is no longer valid"}
      </h1>
      <p>
        It may have expired or already been used. If you have already created
        your password, you can sign in.
      </p>
      <div className="auth-actions">
        <a
          className="button primary"
          href={invite ? "https://pixelalty.com/contact.html" : "/?reset=1"}
        >
          {invite ? "Request a new invitation" : "Request a new password link"}
        </a>
        <a className="button" href="/">
          Back to sign in
        </a>
      </div>
      {invite && (
        <p className="fine-print">
          Tell Pixelalty you need a replacement invitation. Please don’t include
          your password or verification code.
        </p>
      )}
    </AuthShell>
  );
}

export function ConfirmAuthLink({
  client,
  link,
  onComplete,
}: {
  client: SupabaseClient;
  link: AuthLink;
  onComplete: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [invalid, setInvalid] = useState(!!link.invalid),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  if (invalid) return <InvalidAuthLink invite={link.type === "invite"} />;
  if (confirmed)
    return (
      <AuthShell>
        <ShieldCheck size={34} />
        <h1>Email confirmation received</h1>
        <p>
          If you are changing your sign-in email, confirm the message in your
          other inbox too. Then sign in to continue.
        </p>
        <a className="button primary" href="/">
          Back to sign in
        </a>
      </AuthShell>
    );
  const invitation = link.type === "invite",
    recovery = link.type === "recovery";
  return (
    <AuthShell>
      <ShieldCheck size={34} />
      <h1>
        {invitation
          ? "Your Pixelalty invitation"
          : recovery
            ? "Reset your Pixelalty password"
            : "Confirm your Pixelalty email"}
      </h1>
      <p>
        {invitation
          ? "You’ve been invited to Pixelalty Sales. Continue to create your password, then complete your profile and onboarding."
          : "Continue securely to finish this step for your Pixelalty account."}
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const result = link.tokenHash
              ? await client.auth.verifyOtp({
                  token_hash: link.tokenHash,
                  type: link.type,
                })
              : link.code
                ? await client.auth.exchangeCodeForSession(link.code)
                : await client.auth.setSession({
                    access_token: link.accessToken!,
                    refresh_token: link.refreshToken!,
                  });
            if (result.error) {
              if (
                [
                  "otp_expired",
                  "otp_disabled",
                  "flow_state_not_found",
                  "flow_state_expired",
                  "bad_code_verifier",
                  "validation_failed",
                ].includes(result.error.code || "")
              )
                setInvalid(true);
              else
                setError(
                  authErrorMessage(
                    result.error,
                    "We couldn’t verify your link right now. Check your connection and try again.",
                  ),
                );
              return;
            }
            if (!result.data.session) {
              if (link.type === "email_change") setConfirmed(true);
              else setInvalid(true);
              return;
            }
            onComplete(invitation ? "/welcome" : recovery ? "/recover" : "/");
          } catch {
            setError(
              "We couldn’t connect. Check your connection and try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Verifying…"
          : invitation
            ? "Continue to password setup"
            : recovery
              ? "Continue to reset password"
              : "Confirm email"}
      </button>
      <p className="fine-print">
        This extra confirmation protects your one-time link from automatic email
        scanners.
      </p>
    </AuthShell>
  );
}
