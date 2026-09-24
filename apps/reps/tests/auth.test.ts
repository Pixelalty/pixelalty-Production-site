import test from "node:test";
import assert from "node:assert/strict";
import { readAuthLink, authErrorMessage } from "../src/shared/auth";
import {
  authEmail,
  authEmailTypes,
  brandedEmail,
  onboardingEmail,
} from "../src/shared/email";
import { deploymentUrls, mutationOriginAllowed } from "../src/server/urls";
import { rpc } from "../src/server/db";
import worker from "../src/server/index";
import type { Env } from "../src/server/types";
const env = {
  APP_URL: "https://reps.pixelalty.com",
  RECRUITING_URL: "https://join.pixelalty.com",
  INTERNAL_APP_ORIGIN:
    "https://pixelalty-sales-staging.elore-marketing.workers.dev",
  STRIPE_MODE: "test",
  SUPABASE_URL: "https://isolated.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public_fixture",
  SUPABASE_SERVICE_ROLE_KEY: "private-fixture",
  RESEND_API_KEY: "private-mail-fixture",
  EMAIL_FROM: "Pixelalty Sales <sales@pixelalty.com>",
  ASSETS: { fetch: async () => new Response("Pixelalty") },
} as unknown as Env;
test("email links keep tokens in memory and remove credentials and untrusted redirects from browser history", () => {
  const token = "one_time_test_hash_123456789";
  for (const url of [
    "https://reps.pixelalty.com/auth/confirm#token_hash=" +
      token +
      "&type=invite",
    "https://reps.pixelalty.com/auth/confirm?token_hash=" +
      token +
      "&type=invite&email=private%40example.test&next=https://evil.test",
  ]) {
    const parsed = readAuthLink(new URL(url));
    assert.deepEqual(parsed.link, { type: "invite", tokenHash: token });
    assert.equal(parsed.cleanPath, "/auth/confirm");
  }
  assert.equal(
    readAuthLink(
      new URL("https://reps.pixelalty.com/#email=private%40example.test"),
    ).cleanPath,
    "/",
  );
  assert.deepEqual(
    readAuthLink(
      new URL("https://reps.pixelalty.com/leads?view=mine#followups"),
    ),
    { link: null, cleanPath: "/leads?view=mine#followups" },
  );
});
test("legacy implicit and PKCE callbacks work while malformed and expired links fail closed", () => {
  assert.deepEqual(
    readAuthLink(
      new URL(
        "https://reps.pixelalty.com/welcome#access_token=a.b.c&refresh_token=test-refresh-token&type=invite&expires_in=3600",
      ),
    ).link,
    {
      type: "invite",
      accessToken: "a.b.c",
      refreshToken: "test-refresh-token",
    },
  );
  assert.equal(
    readAuthLink(
      new URL("https://reps.pixelalty.com/recover?code=1234567890-abcd"),
    ).link?.code,
    "1234567890-abcd",
  );
  for (const suffix of [
    "",
    "#error=access_denied&error_description=provider_internal",
    "#token_hash=x&type=invite",
    "#token_hash=12345678901234567890&type=owner",
  ]) {
    const result = readAuthLink(
      new URL("https://reps.pixelalty.com/auth/confirm" + suffix),
    );
    assert.equal(result.link?.invalid, true);
    assert.equal(result.cleanPath, "/auth/confirm");
  }
});
test("auth errors and database failures do not expose provider internals", async () => {
  const internal = "Supabase service_role px_private relation token=secret";
  assert.ok(!authErrorMessage({ message: internal }).includes("Supabase"));
  assert.match(
    authErrorMessage({ code: "mfa_verification_failed", message: internal }),
    /latest six-digit code/,
  );
  for (const code of ["42501", "P0001", "XX001"]) {
    await assert.rejects(
      rpc(
        { rpc: async () => ({ error: { code, message: internal } }) } as any,
        "example",
      ),
      (e) => !String(e).includes("secret") && !String(e).includes("Supabase"),
    );
  }
});
test("ten email templates use Pixelalty branding and owned HTTPS links without provider URLs", () => {
  assert.equal(authEmailTypes.length, 10);
  for (const type of authEmailTypes) {
    const email = authEmail(type);
    assert.match(email.html, /PIXELALTY SALES/);
    assert.ok(
      !/supabase|localhost|workers\.dev|service_role/i.test(email.html),
    );
    assert.match(email.html, /Contact Pixelalty/);
    if (
      [
        "invite",
        "recovery",
        "confirmation",
        "magic_link",
        "email_change",
      ].includes(type)
    ) {
      assert.match(
        email.html,
        /https:\/\/reps\.pixelalty\.com\/auth\/confirm#token_hash=\{\{ \.TokenHash \}\}/,
      );
      assert.ok(!email.html.includes("ConfirmationURL"));
    }
  }
  assert.match(authEmail("invite").html, /SET UP YOUR PIXELALTY ACCOUNT/);
  assert.match(
    onboardingEmail("activated", env.APP_URL).html,
    /https:\/\/reps.pixelalty.com\/leads/,
  );
  assert.match(
    brandedEmail({
      subject: "<script>",
      title: "<img src=x>",
      intro: "&unsafe",
      detail: "safe",
    }).html,
    /&lt;img src=x&gt;/,
  );
  assert.throws(() => authEmail("invite", "http://localhost:3000"), /HTTPS/);
});
test("hosted URL configuration rejects localhost, credentials and insecure destinations", () => {
  for (const APP_URL of [
    "http://localhost:3000",
    "https://localhost",
    "http://reps.pixelalty.com",
    "https://secret:password@reps.pixelalty.com",
    "https://reps.pixelalty.com/?token=x",
    "https://reps.pixelalty.com/other",
  ]) {
    assert.throws(
      () => deploymentUrls({ ...env, APP_URL }, env.APP_URL),
      /temporarily unavailable/,
    );
  }
  assert.equal(
    deploymentUrls(
      { ...env, APP_URL: "http://127.0.0.1:4000" },
      "http://127.0.0.1:4000",
    ).app,
    "http://127.0.0.1:4000",
  );
  for (const [origin, path, allowed] of [
    [env.APP_URL, "/api/action", true],
    [env.RECRUITING_URL, "/api/action", false],
    [env.RECRUITING_URL, "/api/apply", true],
    [env.INTERNAL_APP_ORIGIN, "/api/action", true],
    ["https://evil.test", "/api/action", false],
  ] as const) {
    assert.equal(
      mutationOriginAllowed(
        new Request(origin + path, {
          method: "POST",
          headers: { origin: origin! },
        }),
        env,
        path,
      ),
      allowed,
    );
  }
  assert.equal(
    mutationOriginAllowed(
      new Request(env.APP_URL + "/api/action", {
        method: "POST",
        headers: { origin: env.RECRUITING_URL! },
      }),
      env,
      "/api/action",
    ),
    false,
  );
  assert.equal(
    deploymentUrls({ ...env, STRIPE_MODE: "live" }, env.APP_URL).internal,
    "",
  );
});
test("recruiting host exposes only public routes and sends portal traffic to reps", async () => {
  const call = (host: string, path: string) =>
    worker.fetch(new Request(host + path), env);
  const root = await call(env.RECRUITING_URL!, "/");
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("x-robots-tag"), null);
  const admin = await call(env.RECRUITING_URL!, "/admin");
  assert.equal(admin.headers.get("location"), env.APP_URL + "/admin");
  assert.equal((await call(env.RECRUITING_URL!, "/api/me")).status, 404);
  assert.equal(
    (await call(env.APP_URL, "/apply")).headers.get("location"),
    new URL(env.RECRUITING_URL!).href,
  );
  const config = await call(env.RECRUITING_URL!, "/api/config"),
    data = await config.text();
  assert.equal(config.headers.get("referrer-policy"), "no-referrer");
  assert.ok(!data.includes("private-"));
  assert.ok(!data.includes("workers.dev"));
  assert.equal(JSON.parse(data).publicRecruitingHost, true);
  const bad = await worker.fetch(new Request(env.APP_URL), {
    ...env,
    APP_URL: "http://localhost:3000",
  });
  assert.equal(bad.status, 503);
  assert.ok(!(await bad.text()).includes("localhost"));
});

test("internal UI redirects to owned domains while APIs, webhooks and assets remain available", async () => {
  const root = env.INTERNAL_APP_ORIGIN!;
  for (const [path, expected] of [
    ["/admin/recruiting", env.APP_URL + "/admin/recruiting"],
    [
      "/leads?view=mine&Email=private%40example.test&client_secret=secret",
      env.APP_URL + "/leads?view=mine",
    ],
    ["/apply?campaign=careers", env.RECRUITING_URL + "/?campaign=careers"],
    ["/onboarding?step=tax", env.APP_URL + "/onboarding?step=tax"],
  ]) {
    const response = await worker.fetch(new Request(root + path), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const token = "invitation_test_hash_123456789";
  const callback = await worker.fetch(
    new Request(
      root +
        "/auth/confirm?token_hash=" +
        token +
        "&type=invite&email=private%40example.test",
    ),
    env,
  );
  const next = new URL(callback.headers.get("location")!);
  assert.equal(next.origin, env.APP_URL);
  assert.equal(next.search, "");
  assert.ok(!next.href.includes("private"));
  assert.deepEqual(readAuthLink(next), {
    link: { type: "invite", tokenHash: token },
    cleanPath: "/auth/confirm",
  });
  for (const path of [
    "/api/config",
    "/assets/app.js",
    "/fonts/manrope.woff2",
  ]) {
    const response = await worker.fetch(new Request(root + path), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  }
  const webhook = await worker.fetch(
    new Request(root + "/api/webhooks/stripe", { method: "GET" }),
    env,
  );
  assert.equal(webhook.status, 405);
  assert.equal(webhook.headers.get("location"), null);
  assert.equal(
    readAuthLink(
      new URL(
        env.APP_URL +
          "/leads?Email=private&client_secret=private&rep_id=private&view=mine#refreshToken=private",
      ),
    ).cleanPath,
    "/leads?view=mine",
  );
});
