import { client, rpc } from "./db";
import { HttpError, type Env } from "./types";
export const smsConfigured = (env: Env) =>
  !!(
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_MESSAGING_SERVICE_SID
  );

export async function drainSms(env: Env) {
  if (!smsConfigured(env)) return;
  const db = client(env, undefined, true);
  for (let n = 0; n < 2; n++) {
    const job = await rpc(db, "px_sms", { action: "claim", p: {} });
    if (!job) return;
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization:
              "Basic " +
              btoa(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: job.phone,
            MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID!,
            Body: "Pixelalty Sales: Your application has been approved. Check your email and Spam/Junk folder for your account setup invitation. Reply STOP to opt out.",
          }),
        },
      );
      const result = (await response.json()) as { sid?: string };
      await rpc(db, "px_sms", {
        action: response.ok && result.sid ? "sent" : "review",
        p: { id: job.id, provider_id: response.ok ? result.sid : null },
      });
    } catch {
      // Twilio send has no durable app idempotency key: uncertain attempts are
      // never automatically replayed. Owner review prevents duplicate texts.
      await rpc(db, "px_sms", { action: "review", p: { id: job.id } }).catch(
        () => {},
      );
    }
  }
}
export async function validSmsSignature(
  token: string,
  url: string,
  params: URLSearchParams,
  signature: string,
) {
  const payload =
    url +
    [...new Set(params.keys())]
      .sort()
      .map((k) => k + params.getAll(k).sort().join(k))
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["verify"],
  );
  try {
    const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}
export async function receiveSms(env: Env, req: Request, text: string) {
  if (!env.TWILIO_AUTH_TOKEN)
    throw new HttpError(503, "SMS notifications are not configured.");
  if (Number(req.headers.get("content-length")) > 16384)
    throw new HttpError(413, "Request is too large.");
  if (text.length > 16384) throw new HttpError(413, "Request is too large.");
  const params = new URLSearchParams(text);
  if (
    !(await validSmsSignature(
      env.TWILIO_AUTH_TOKEN,
      req.url,
      params,
      req.headers.get("x-twilio-signature") || "",
    ))
  )
    throw new HttpError(400, "Invalid notification signature.");
  const message = (params.get("Body") || "").trim().toUpperCase();
  if (
    params.get("OptOutType") === "STOP" ||
    [
      "STOP",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
      "REVOKE",
      "OPTOUT",
    ].includes(message)
  )
    await rpc(client(env, undefined, true), "px_sms", {
      action: "stop",
      p: { phone: params.get("From") },
    });
  return new Response("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
