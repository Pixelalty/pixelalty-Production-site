import type { Env } from "./types";
import { client, rpc } from "./db";
import { onboardingEmail } from "../shared/email";
export function mailConfigured(env: Env) {
  return !!(
    env.APP_URL?.replace(/\/$/, "") === "https://reps.pixelalty.com" &&
    env.RESEND_API_KEY &&
    /^Pixelalty Sales <[^<>\s@]+@(?:[a-z0-9-]+\.)*pixelalty\.com>$/i.test(
      env.EMAIL_FROM || "",
    )
  );
}
export async function drainMail(env: Env, limit = 3) {
  if (!mailConfigured(env)) return;
  const db = client(env, undefined, true);
  for (let i = 0; i < limit; i++) {
    const job = await rpc(db, "px_mail", { action: "claim", p: {} });
    if (!job) return;
    const key = { id: job.id, lease_token: job.lease_token };
    try {
      const copy = onboardingEmail(job.template, env.APP_URL);
      const payload = await rpc(db, "px_mail", {
        action: "prepare",
        p: {
          ...key,
          payload: { from: env.EMAIL_FROM, to: [job.email], ...copy },
        },
      });
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json",
          "Idempotency-Key": "pixelalty-mail/" + job.id,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        await response.body?.cancel();
        await rpc(db, "px_mail", {
          action: "failed",
          p: {
            ...key,
            error_code: "provider_status_" + response.status,
            permanent:
              response.status < 500 &&
              ![408, 409, 429].includes(response.status),
          },
        });
        if (response.status === 429 || response.status >= 500) return;
        continue;
      }
      const result = (await response.json()) as { id?: string };
      if (!result.id) throw Error("Missing delivery receipt");
      await rpc(db, "px_mail", {
        action: "sent",
        p: { ...key, provider_id: result.id },
      });
    } catch {
      // Never log recipient addresses, message bodies, links, tokens or API secrets.
      console.error("mail_delivery_retry", job.id);
      await rpc(db, "px_mail", {
        action: "failed",
        p: { ...key, error_code: "delivery_uncertain" },
      }).catch(() => {});
    }
  }
}
