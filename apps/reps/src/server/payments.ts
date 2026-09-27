import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { client, rpc, service } from "./db";
import { type Env, HttpError } from "./types";
import { paymentOperation } from "./diagnostics";
import { deploymentUrls } from "./urls";
import type { Row } from "../shared/core";
export function stripe(env: Env) {
  if (
    !env.STRIPE_SECRET_KEY ||
    !new RegExp(`^(sk|rk)_${env.STRIPE_MODE}_`).test(env.STRIPE_SECRET_KEY)
  )
    throw new HttpError(
      503,
      "Pixelalty’s payment connection needs attention. Contact Pixelalty support.",
      "PAYMENT_MODE_CONFIGURATION",
    );
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}
const id = (value: any): string =>
  typeof value === "string" ? value : value?.id;
async function one(
  db: SupabaseClient,
  table: string,
  key: string,
  value: string,
) {
  const r = await db.from(table).select("*").eq(key, value).single();
  if (r.error || !r.data) throw new HttpError(404, "Record not found.");
  return r.data;
}
export async function checkout(
  env: Env,
  db: SupabaseClient,
  userId: string,
  dealId: string,
) {
  const deal = await one(db, "px_deals", "id", dealId),
    ctx = await rpc(db, "px_context");
  const admin =
    ctx.aal === "aal2" &&
    (ctx.roles.includes("owner") || ctx.roles.includes("sales_admin"));
  if (
    (!admin && (ctx.rep?.status !== "active" || deal.rep_id !== userId)) ||
    deal.stage === "paid" ||
    deal.stage === "cancelled"
  )
    throw new HttpError(403, "This deal is not eligible for checkout.");
  const lead = await one(db, "px_businesses", "id", deal.business_id);
  if (
    lead.owner_id !== deal.rep_id ||
    lead.dnc ||
    lead.customer ||
    lead.archived ||
    new Date(lead.expires_at).getTime() < Date.now()
  )
    throw new HttpError(403, "The lead is no longer available.");
  const s = stripe(env);
  if (deal.checkout_id) {
    const session = await s.checkout.sessions.retrieve(deal.checkout_id);
    if (session.status !== "open" || !session.url)
      throw new HttpError(
        409,
        "This checkout is no longer open. Create a new deal after checking payment status.",
      );
    return { url: session.url };
  }
  await service(env, "checkout_begin", {
    deal_id: deal.id,
    rep_id: deal.rep_id,
  });
  const metadata = {
    deal_id: deal.id,
    rep_id: deal.rep_id,
    business_id: deal.business_id,
    package_id: deal.package_id,
  };
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: deal.customer_email,
      client_reference_id: deal.id,
      metadata,
      payment_intent_data: { metadata, transfer_group: deal.id },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: deal.price_cents,
            product_data: { name: `Pixelalty ${deal.package_name}` },
          },
        },
      ],
      success_url: `${env.APP_URL}/payment-return?status=success`,
      cancel_url: `${env.APP_URL}/payment-return?status=cancelled`,
    },
    { idempotencyKey: `checkout:${deal.id}` },
  );
  await service(env, "checkout_attach", {
    deal_id: deal.id,
    checkout_id: session.id,
    url: session.url,
  });
  return { url: session.url };
}
export async function syncAccount(env: Env, account: Stripe.Account) {
  const db = client(env, undefined, true);
  let repId = account.metadata?.rep_id;
  const found = await db
    .from("px_connect")
    .select("rep_id")
    .eq("account_id", account.id)
    .maybeSingle();
  if (found.error)
    throw new HttpError(
      502,
      "Payout setup could not be read. Please retry.",
      "CONNECT_MAPPING_READ",
    );
  if (found.data) repId = found.data.rep_id;
  if (!repId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(repId))
    throw new HttpError(
      409,
      "Connected account is not attributed to a rep.",
      "CONNECT_UNATTRIBUTED",
    );
  const mapped = await service(env, "connect", {
    rep_id: repId,
    account_id: account.id,
    transfers_enabled: account.capabilities?.transfers === "active",
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
    requirements: account.requirements?.currently_due || [],
  });
  if (mapped?.unattributed)
    throw new HttpError(
      409,
      "Connected account is not attributed to an available rep.",
      "CONNECT_UNATTRIBUTED",
    );
  return account;
}
export async function connectAccount(
  env: Env,
  db: SupabaseClient,
  userId: string,
  refresh: boolean | "prepare" = false,
) {
  const profile = await one(db, "px_rep_private", "rep_id", userId);
  if (profile.classification !== "contractor")
    throw new HttpError(
      409,
      "An administrator must configure contractor classification first. Employee payouts use the configured payroll provider.",
    );
  const s = stripe(env),
    existing = await db
      .from("px_connect")
      .select("*")
      .eq("rep_id", userId)
      .maybeSingle();
  if (existing.error) throw new HttpError(500, "Unable to read payout setup.");
  if (refresh === true && !existing.data)
    return { refreshed: true, started: false };
  const attempt = !existing.data
    ? await service(env, "connect_begin", { rep_id: userId })
    : null;
  if (attempt?.needs_reconcile)
    throw new HttpError(
      409,
      "Your previous payout setup needs an administrator’s review. Contact Pixelalty support to reconnect it.",
      "CONNECT_RECONCILIATION_REQUIRED",
    );
  const account = await paymentOperation("connect_account", () =>
    existing.data
      ? s.accounts.retrieve(existing.data.account_id)
      : s.accounts.create(
          {
            type: "express",
            email: profile.email,
            capabilities: { transfers: { requested: true } },
            metadata: { rep_id: userId },
          },
          { idempotencyKey: attempt?.idempotency_key || `connect:${userId}` },
        ),
  );
  await syncAccount(env, account);
  if (refresh) return { refreshed: true };
  const appUrl = deploymentUrls(env, env.APP_URL).app;
  const link = await paymentOperation("connect_link", () =>
    s.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      refresh_url: `${appUrl}/onboarding?connect=refresh`,
      return_url: `${appUrl}/onboarding?connect=returned`,
    }),
  );
  return { url: link.url };
}

// Explicit, audited recovery. Enumerate the platform before rotating an attempt
// so a lost create response cannot silently result in a duplicate Express account.
export async function recoverConnect(
  env: Env,
  db: SupabaseClient,
  actorId: string,
  p: Row,
) {
  await finance(db);
  if (String(p.reason || "").trim().length < 5)
    throw new HttpError(400, "Enter an audit reason.");
  const rep = await one(db, "px_reps", "id", p.id);
  const s = stripe(env),
    matches: Stripe.Account[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await paymentOperation("connect_reconcile", () =>
      s.accounts.list({
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      }),
    );
    matches.push(...result.data.filter((a) => a.metadata?.rep_id === rep.id));
    if (!result.has_more) break;
    cursor = result.data.at(-1)?.id;
    if (page === 99)
      throw new HttpError(
        409,
        "Account history requires further Finance review.",
        "CONNECT_RECONCILE_LIMIT",
      );
  }
  if (matches.length > 1)
    throw new HttpError(
      409,
      "Multiple payout accounts were found. Finance must reconcile the matching account before continuing.",
      "CONNECT_MULTIPLE_ACCOUNTS",
    );
  if (matches.length === 1) {
    const current = await client(env, undefined, true)
      .from("px_connect")
      .select("account_id")
      .eq("rep_id", rep.id)
      .maybeSingle();
    if (current.error)
      throw new HttpError(
        502,
        "Payout setup could not be read.",
        "CONNECT_MAPPING_READ",
      );
    if (current.data && current.data.account_id !== matches[0].id) {
      if (env.STRIPE_MODE !== "test")
        throw new HttpError(
          409,
          "Finance must review the existing account mapping.",
          "CONNECT_RECONCILIATION_REQUIRED",
        );
      await service(env, "connect_reset", {
        rep_id: rep.id,
        actor_id: actorId,
        reason: p.reason,
      });
    }
    await syncAccount(env, matches[0]);
    await rpc(db, "px_action", {
      action: "finance_reconcile",
      p: { id: rep.id, reason: p.reason },
    });
    return { recovered: true, ready: matches[0].payouts_enabled };
  }
  if (env.STRIPE_MODE !== "test")
    throw new HttpError(
      409,
      "No matching payout account was found. Finance must review this account before resetting it.",
      "CONNECT_RECONCILIATION_REQUIRED",
    );
  const prior = await client(env, undefined, true)
    .from("px_connect_requests")
    .select("started_at,account_id")
    .eq("rep_id", rep.id)
    .maybeSingle();
  if (prior.error)
    throw new HttpError(
      502,
      "Payout setup could not be read.",
      "CONNECT_MAPPING_READ",
    );
  const retrySameAttempt =
    prior.data &&
    !prior.data.account_id &&
    Date.parse(prior.data.started_at) > Date.now() - 23 * 60 * 60 * 1000;
  if (!retrySameAttempt)
    await service(env, "connect_reset", {
      rep_id: rep.id,
      actor_id: actorId,
      reason: p.reason,
    });
  // Complete the authorized recovery through the same account-creation path.
  // The rep still creates their own fresh Account Link; none is stored or shared.
  await connectAccount(env, db, rep.id, "prepare");
  await rpc(db, "px_action", {
    action: "finance_reconcile",
    p: { id: rep.id, reason: p.reason },
  });
  return { reset: true, recovered: true };
}

export async function reconcilePayment(
  env: Env,
  s: Stripe,
  piId: string,
  eventId: string,
  eventType: string,
) {
  const pi = await s.paymentIntents.retrieve(piId, {
    expand: ["latest_charge.balance_transaction"],
  });
  if (pi.status !== "succeeded")
    throw new HttpError(409, "Payment has not succeeded.");
  const charge = pi.latest_charge as Stripe.Charge;
  if (!charge?.id || !charge.paid || !charge.captured)
    throw new HttpError(409, "Captured charge not found.");
  const sessions = await s.checkout.sessions.list({
    payment_intent: pi.id,
    limit: 10,
  });
  const session = sessions.data.find(
    (x) => x.metadata?.deal_id === pi.metadata.deal_id,
  );
  if (!session || session.payment_status !== "paid" || !pi.metadata.deal_id)
    throw new HttpError(
      409,
      "Payment has no verified Pixelalty Sales checkout attribution.",
    );
  const balance = charge.balance_transaction as Stripe.BalanceTransaction;
  const disputes = await s.disputes.list({ charge: charge.id, limit: 100 });
  if (disputes.has_more)
    throw new HttpError(409, "Dispute history requires manual reconciliation.");
  const disputed = disputes.data.some(
    (x) => !["won", "warning_closed"].includes(x.status),
  );
  return service(env, "payment", {
    event_id: eventId,
    event_type: eventType,
    deal_id: pi.metadata.deal_id,
    rep_id: pi.metadata.rep_id,
    package_id: pi.metadata.package_id,
    checkout_id: session.id,
    payment_intent: pi.id,
    charge_id: charge.id,
    amount_cents: pi.amount_received,
    currency: pi.currency,
    refunded_cents: charge.amount_refunded,
    disputed,
    settled: balance?.status === "available",
    available_at: balance?.available_on
      ? new Date(balance.available_on * 1000).toISOString()
      : null,
  });
}
export async function webhook(
  env: Env,
  body: string,
  signature: string,
  connect = false,
) {
  const secret = connect
    ? env.STRIPE_CONNECT_WEBHOOK_SECRET
    : env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "Webhook secret is not configured.");
  const s = stripe(env);
  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(
      body,
      signature,
      secret,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HttpError(400, "Invalid webhook signature.");
  }
  if (event.livemode !== (env.STRIPE_MODE === "live"))
    throw new HttpError(400, "Webhook mode mismatch.");
  const obj = event.data.object as any;
  await service(env, "event_received", {
    event_id: event.id,
    event_type: event.type,
    channel: connect ? "connect" : "platform",
    account_id: event.account || null,
  });
  try {
    if (connect && event.type === "account.updated")
      await syncAccount(
        env,
        await paymentOperation("connect_account", () =>
          s.accounts.retrieve(obj.id),
        ),
      );
    else if (connect && event.type.startsWith("payout.")) {
      if (!event.account)
        throw new HttpError(
          409,
          "Connected account is required.",
          "CONNECT_UNATTRIBUTED",
        );
      await syncAccount(
        env,
        await paymentOperation("connect_account", () =>
          s.accounts.retrieve(event.account!),
        ),
      );
      const payout = await s.payouts.retrieve(
        obj.id,
        {},
        { stripeAccount: event.account },
      );
      await service(env, "payout", {
        id: payout.id,
        account_id: event.account,
        amount_cents: payout.amount,
        currency: payout.currency,
        status: payout.status,
        arrival_at: new Date(payout.arrival_date * 1000).toISOString(),
      });
    } else if (event.type === "transfer.reversed") {
      const reversals = await s.transfers.listReversals(obj.id, { limit: 100 });
      if (reversals.has_more)
        throw new HttpError(409, "Reversal history requires manual review.");
      for (const r of reversals.data)
        await service(env, "reversal", {
          transfer_id: obj.id,
          reversal_id: r.id,
          amount_cents: r.amount,
          request_id: r.metadata?.request_id,
        });
    } else {
      let piId: string | undefined;
      if (
        [
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(event.type)
      ) {
        const session = await s.checkout.sessions.retrieve(obj.id);
        if (session.payment_status === "paid")
          piId = id(session.payment_intent);
      } else if (event.type === "payment_intent.succeeded") piId = obj.id;
      else if (event.type === "charge.refunded")
        piId = id((await s.charges.retrieve(obj.id)).payment_intent);
      else if (event.type.startsWith("charge.dispute."))
        piId = id((await s.charges.retrieve(id(obj.charge))).payment_intent);
      if (piId) {
        await reconcilePayment(env, s, piId, event.id, event.type);
        return { received: true };
      }
    }
    await service(env, "event_ignored", {
      event_id: event.id,
      event_type: event.type,
    });
    return { received: true };
  } catch (e) {
    if (
      e instanceof HttpError &&
      ["CONNECT_UNATTRIBUTED", "CONNECT_ACCOUNT_UNAVAILABLE"].includes(
        e.category,
      )
    ) {
      await service(env, "event_unattributed", {
        event_id: event.id,
        event_type: event.type,
        category: e.category,
      });
      return { received: true };
    }
    await service(env, "event_error", {
      event_id: event.id,
      event_type: event.type,
      error:
        e instanceof HttpError ? e.message : "Provider reconciliation failed",
    });
    throw e;
  }
}
async function finance(db: SupabaseClient) {
  const ctx = await rpc(db, "px_context");
  if (
    ctx.aal !== "aal2" ||
    !ctx.roles.some((x: string) => ["owner", "finance_admin"].includes(x))
  )
    throw new HttpError(403, "Finance access and MFA are required.");
}
export async function transfer(env: Env, db: SupabaseClient, p: Row) {
  await finance(db);
  const s = stripe(env),
    admin = client(env, undefined, true),
    comm = await one(db, "px_commissions", "id", p.id),
    payment = await one(admin, "px_payments", "deal_id", comm.deal_id),
    account = await one(admin, "px_connect", "rep_id", comm.rep_id);
  await syncAccount(env, await s.accounts.retrieve(account.account_id));
  await reconcilePayment(
    env,
    s,
    payment.payment_intent,
    `reconcile:${crypto.randomUUID()}`,
    "manual.reconciliation",
  );
  const request = await rpc(db, "px_action", { action: "queue_transfer", p });
  if (request.status === "complete")
    return { transfer_id: request.transfer_id };
  if (
    request.status === "uncertain" ||
    Date.now() - Date.parse(request.created_at) > 23 * 3600 * 1000
  )
    throw new HttpError(
      409,
      "Reconcile this transfer in Stripe before retrying.",
    );
  try {
    const result = await s.transfers.create(
      {
        amount: comm.amount_cents,
        currency: "usd",
        destination: account.account_id,
        source_transaction: payment.charge_id,
        transfer_group: comm.deal_id,
        metadata: { commission_id: comm.id, request_id: request.id },
      },
      { idempotencyKey: `commission:${request.id}` },
    );
    await service(env, "transfer_result", {
      request_id: request.id,
      transfer_id: result.id,
    });
    return { transfer_id: result.id };
  } catch (e) {
    await service(env, "transfer_result", { request_id: request.id });
    throw new HttpError(
      502,
      e instanceof Stripe.errors.StripeError
        ? "Transfer requires finance reconciliation."
        : "Transfer result could not be recorded. Check Stripe before retrying.",
    );
  }
}
export async function reverse(env: Env, db: SupabaseClient, p: Row) {
  await finance(db);
  if (
    !/^[0-9a-f-]{36}$/i.test(p.request_id || "") ||
    String(p.reason || "").trim().length < 5
  )
    throw new HttpError(400, "A request ID and audit reason are required.");
  const comm = await one(db, "px_commissions", "id", p.id),
    amount = Number(p.amount_cents);
  if (
    !comm.transfer_id ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > comm.amount_cents
  )
    throw new HttpError(400, "Invalid reversal amount.");
  const request = await service(env, "reversal_begin", {
    commission_id: comm.id,
    request_id: p.request_id,
    amount_cents: amount,
    reason: p.reason,
  });
  if (request.status === "complete")
    return { reversal_id: request.reversal_id };
  await rpc(db, "px_action", {
    action: "finance_reconcile",
    p: { id: comm.id, reason: p.reason },
  });
  const r = await stripe(env).transfers.createReversal(
    comm.transfer_id,
    {
      amount,
      metadata: {
        reason: String(p.reason).slice(0, 400),
        request_id: p.request_id,
      },
    },
    { idempotencyKey: `reversal:${comm.id}:${p.request_id}` },
  );
  await service(env, "reversal", {
    transfer_id: comm.transfer_id,
    reversal_id: r.id,
    amount_cents: r.amount,
    reason: p.reason,
    request_id: p.request_id,
  });
  return { reversal_id: r.id };
}
export async function reconcile(env: Env, db: SupabaseClient, p: Row) {
  await finance(db);
  if (String(p.reason || "").trim().length < 5)
    throw new HttpError(400, "Enter an audit reason.");
  const s = stripe(env),
    admin = client(env, undefined, true);
  if (p.kind === "connect") {
    const account = await s.accounts.retrieve(p.object_id);
    if (account.metadata?.rep_id !== p.id)
      throw new HttpError(409, "Connected account does not match this rep.");
    await syncAccount(env, account);
  } else if (p.kind === "checkout") {
    const deal = await one(db, "px_deals", "id", p.id),
      session = await s.checkout.sessions.retrieve(p.object_id);
    if (
      session.metadata?.deal_id !== deal.id ||
      session.metadata?.rep_id !== deal.rep_id ||
      session.metadata?.package_id !== deal.package_id ||
      session.amount_total !== deal.price_cents ||
      session.currency !== deal.currency ||
      session.livemode !== (env.STRIPE_MODE === "live")
    )
      throw new HttpError(409, "Checkout does not match this deal.");
    await service(env, "checkout_attach", {
      deal_id: deal.id,
      checkout_id: session.id,
      url: session.url,
    });
    if (session.payment_status === "paid")
      await reconcilePayment(
        env,
        s,
        id(session.payment_intent),
        `reconcile:${crypto.randomUUID()}`,
        "manual.reconciliation",
      );
  } else if (p.kind === "transfer") {
    const request = await one(db, "px_transfer_requests", "id", p.id),
      comm = await one(db, "px_commissions", "id", request.commission_id),
      account = await one(admin, "px_connect", "rep_id", comm.rep_id),
      t = await s.transfers.retrieve(p.object_id);
    if (
      t.metadata.request_id !== request.id ||
      t.metadata.commission_id !== comm.id ||
      t.amount !== comm.amount_cents ||
      id(t.destination) !== account.account_id ||
      t.currency !== "usd"
    )
      throw new HttpError(409, "Transfer does not match this request.");
    await service(env, "transfer_result", {
      request_id: request.id,
      transfer_id: t.id,
    });
  } else if (p.kind === "reversal") {
    const request = await one(db, "px_reversal_requests", "id", p.id),
      comm = await one(db, "px_commissions", "id", request.commission_id),
      r = await s.transfers.retrieveReversal(comm.transfer_id, p.object_id);
    if (
      r.metadata?.request_id !== request.id ||
      r.amount !== request.amount_cents
    )
      throw new HttpError(409, "Reversal does not match this request.");
    await service(env, "reversal", {
      request_id: request.id,
      transfer_id: comm.transfer_id,
      reversal_id: r.id,
      amount_cents: r.amount,
      reason: p.reason,
    });
  } else throw new HttpError(400, "Select checkout, transfer, or reversal.");
  await rpc(db, "px_action", {
    action: "finance_reconcile",
    p: { id: p.id, reason: p.reason },
  });
  return { reconciled: true };
}
