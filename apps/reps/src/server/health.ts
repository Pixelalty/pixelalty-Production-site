import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "./db";
import { stripe } from "./payments";
import { paymentError } from "./diagnostics";
import { deploymentUrls } from "./urls";
import type { Env } from "./types";
export async function stripeHealth(env: Env, db: SupabaseClient) {
  const data = await rpc(db, "px_report", { kind: "stripe_health", p: {} });
  const result = {
    ...data,
    mode: env.STRIPE_MODE.toUpperCase(),
    platform_api: "Error",
    platform_account: "Not verified",
    category: "",
    platform_destination: "Not verified",
    connect_destination: "Not verified",
    separate_signatures:
      !!env.STRIPE_WEBHOOK_SECRET &&
      !!env.STRIPE_CONNECT_WEBHOOK_SECRET &&
      env.STRIPE_WEBHOOK_SECRET !== env.STRIPE_CONNECT_WEBHOOK_SECRET,
  };
  try {
    const s = stripe(env);
    const account = await s.accounts.retrieveCurrent();
    result.platform_api = "Connected";
    result.platform_account = account.id;
    const endpoints = await s.webhookEndpoints.list({ limit: 100 });
    const origin = deploymentUrls(env, env.APP_URL).app;
    result.platform_destination = endpoints.data.some(
      (e) =>
        e.url === origin + "/api/webhooks/stripe" && e.status === "enabled",
    )
      ? "Configured in this sandbox"
      : "Not found in this sandbox";
    result.connect_destination = endpoints.data.some(
      (e) =>
        e.url === origin + "/api/webhooks/connect" && e.status === "enabled",
    )
      ? "Configured in this sandbox"
      : "Not found in this sandbox";
  } catch (error) {
    result.category = paymentError(error, "health").category;
  }
  return result;
}
