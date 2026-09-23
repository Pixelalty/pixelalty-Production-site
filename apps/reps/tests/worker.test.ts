import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import worker from "../src/server/index";
import type { Env } from "../src/server/types";
const env = {
  APP_URL: "https://sales.example.test",
  SUPABASE_URL: "https://database.example.test",
  SUPABASE_PUBLISHABLE_KEY: "public_fixture",
  SUPABASE_SERVICE_ROLE_KEY: "service_fixture_not_real",
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_fixture_not_real",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_not_real",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect_fixture_not_real",
  ASSETS: { fetch: async () => new Response("<html>App</html>") },
} as unknown as Env;
const request = (
  path: string,
  method = "GET",
  body?: string,
  headers: Record<string, string> = {},
) => new Request(env.APP_URL + path, { method, headers, body });
test("public config never returns server secrets, and responses have security headers", async () => {
  const r = await worker.fetch(request("/api/config"), env),
    s = await r.text();
  assert.equal(r.status, 200);
  assert.match(s, /public_fixture/);
  for (const secret of [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.STRIPE_SECRET_KEY,
    env.STRIPE_WEBHOOK_SECRET,
  ])
    assert.ok(!s.includes(secret));
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(
    r.headers.get("content-security-policy") || "",
    /frame-ancestors 'none'/,
  );
});
test("authenticated API and mutation origin boundaries fail closed", async () => {
  assert.equal(
    (await worker.fetch(request("/api/table?name=businesses"), env)).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/api/action", "POST", "{}", {
          origin: "https://evil.example.test",
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/api/apply", "POST", "{}", { origin: env.APP_URL }),
        env,
      )
    ).status,
    503,
  );
});
test("recruiting is indexable while private app pages are not", async () => {
  assert.equal(
    (await worker.fetch(request("/apply"), env)).headers.get("x-robots-tag"),
    null,
  );
  assert.equal(
    (await worker.fetch(request("/money"), env)).headers.get("x-robots-tag"),
    "noindex, nofollow",
  );
});
test("webhooks reject invalid signatures, old signatures, mode mismatch, and oversized bodies", async () => {
  const s = new Stripe(env.STRIPE_SECRET_KEY);
  const payload = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    type: "unsupported.fixture",
    livemode: false,
    data: { object: { id: "obj_fixture" } },
  });
  assert.equal(
    (
      await worker.fetch(
        request("/api/webhooks/stripe", "POST", payload, {
          "stripe-signature": "invalid",
        }),
        env,
      )
    ).status,
    400,
  );
  const old = s.webhooks.generateTestHeaderString({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
    timestamp: Math.floor(Date.now() / 1000) - 1000,
  });
  assert.equal(
    (
      await worker.fetch(
        request("/api/webhooks/stripe", "POST", payload, {
          "stripe-signature": old,
        }),
        env,
      )
    ).status,
    400,
  );
  const live = payload.replace('"livemode":false', '"livemode":true'),
    sig = s.webhooks.generateTestHeaderString({
      payload: live,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });
  assert.equal(
    (
      await worker.fetch(
        request("/api/webhooks/stripe", "POST", live, {
          "stripe-signature": sig,
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/api/webhooks/stripe", "POST", "a".repeat(1024 * 1024 + 1)),
        env,
      )
    ).status,
    413,
  );
});
test("a valid signed unsupported event is logged only through the service boundary", async () => {
  const original = globalThis.fetch,
    calls: any[] = [];
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push({
      url: req.url,
      body: await req.json(),
      key: req.headers.get("apikey"),
    });
    return Response.json({});
  };
  try {
    const s = new Stripe(env.STRIPE_SECRET_KEY),
      payload = JSON.stringify({
        id: "evt_fixture",
        object: "event",
        type: "unsupported.fixture",
        livemode: false,
        data: { object: {} },
      }),
      signature = s.webhooks.generateTestHeaderString({
        payload,
        secret: env.STRIPE_WEBHOOK_SECRET,
      });
    const r = await worker.fetch(
      request("/api/webhooks/stripe", "POST", payload, {
        "stripe-signature": signature,
      }),
      env,
    );
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, "event_ignored");
    assert.equal(calls[0].key, env.SUPABASE_SERVICE_ROLE_KEY);
  } finally {
    globalThis.fetch = original;
  }
});
