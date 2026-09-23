// Isolated browser fixtures only. This harness never connects to production services.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:5173",
  out = new URL("../test-results/", import.meta.url);
await mkdir(out, { recursive: true });
const userId = "00000000-0000-4000-8000-000000000001",
  businessId = "00000000-0000-4000-8000-000000000010";
const now = Date.now();
const token =
  Buffer.from("{}").toString("base64url") +
  "." +
  Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(now / 1000) + 3600,
      aal: "aal2",
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url") +
  ".test-fixture";
const session = {
  access_token: token,
  refresh_token: "test-refresh",
  expires_at: Math.floor(now / 1000) + 3600,
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: userId,
    email: "qa@example.test",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
};
const rep = {
  id: userId,
  code: "PXL-TEST",
  name: "Jordan Test",
  timezone: "America/New_York",
  status: "active",
  capacity: 10,
};
const business = {
  id: businessId,
  code: "BIZ-TEST",
  name: "Example Home Services",
  phone: "+12125550100",
  domain: "example.test",
  email: "customer@example.test",
  city: "New York",
  state: "NY",
  industry: "Home services",
  timezone: "America/New_York",
  contact: "Business owner",
  owner_id: userId,
  stage: "working",
  expires_at: new Date(now + 86400000).toISOString(),
  notes: "Isolated browser test fixture. Never imported into production.",
};
const tables = {
  businesses: [business],
  reps: [rep],
  content: [
    {
      id: "script-test",
      kind: "script",
      title: "Opening",
      active: true,
      body: "Hi, this is [your name] with Pixelalty. Is now a suitable time for a brief question about [business name]’s website?",
      version: 1,
    },
  ],
  calls: [],
  followups: [],
  packages: [
    {
      id: "pkg-test",
      name: "Launch",
      active: true,
      price_cents: 79900,
      commission_cents: 12500,
    },
  ],
  imports: [],
  notifications: [],
};
const errors = [],
  actions = [];
const browser = await chromium.launch({
  ...(process.env.PIXELALTY_CHROMIUM_PATH
    ? { executablePath: process.env.PIXELALTY_CHROMIUM_PATH }
    : {}),
  headless: true,
  args: process.env.PIXELALTY_CHROMIUM_ARGS
    ? JSON.parse(process.env.PIXELALTY_CHROMIUM_ARGS)
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (s) => sessionStorage.setItem("sb-test-auth-token", JSON.stringify(s)),
    session,
  );
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url()),
      path = u.pathname;
    let data = {};
    if (path === "/api/config")
      data = {
        configured: true,
        supabaseUrl: "https://test.supabase.co",
        publishableKey: "public-test-fixture",
        mode: "test",
      };
    else if (path === "/api/me")
      data = {
        rep,
        roles: ["owner"],
        aal: "aal2",
        email_verified: true,
        settings: {
          calling_enabled: false,
          call_start: 9,
          call_end: 17,
          hold_days: 7,
          first_attempt_hours: 48,
          ownership_days: 14,
          recruiting_open: true,
        },
      };
    else if (path === "/api/table") {
      const rows = tables[u.searchParams.get("name")] || [];
      data = { rows, total: rows.length, page: 0 };
    } else if (path === "/api/report") {
      if (u.searchParams.get("kind") === "leaderboard")
        data = [{ ...rep, rank: 1, sales: 3, xp: 720, calls: 45 }];
      else
        data = {
          calls_today: 8,
          sales: 3,
          xp: 720,
          leads: 1,
          followups: 0,
          earned: 37500,
          transferred: 12500,
          activity: [],
        };
    } else if (path === "/api/action") {
      actions.push(route.request().postDataJSON());
      data = { id: "call-test" };
    } else if (path === "/api/import/preview")
      data = {
        filename: "qa.csv",
        headers: ["Business", "Phone", "Timezone"],
        rows: [
          {
            Business: "QA Import",
            Phone: "2125550101",
            Timezone: "America/New_York",
          },
        ],
      };
    else if (path === "/api/import/prepare") data = { id: "batch-test" };
    else if (path === "/api/health")
      data = { database: true, payments: false, mode: "test" };
    else if (path === "/api/recruiting")
      data = { recruiting_open: false, packages: [] };
    await route.fulfill({ json: data });
  });
  await page.route("https://test.supabase.co/**", (route) =>
    route.fulfill({ json: { user: session.user } }),
  );
  await page.goto(base);
  await page.getByRole("heading", { name: "Hello, Jordan." }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: new URL("dashboard-desktop.png", out).pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  await page.getByRole("heading", { name: "Example Home Services" }).waitFor();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await page
    .getByPlaceholder("What mattered? What happens next?")
    .fill("QA isolated conversation note.");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("1 logged this session"),
  );
  assert.equal(actions[0].action, "call");
  assert.equal(actions[0].p.outcome, "conversation");
  assert.ok(actions[0].p.request_id);
  await page.screenshot({
    path: new URL("focus-desktop.png", out).pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Follow-up", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "Import leads", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "qa.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Business,Phone,Timezone\nQA Import,2125550101,America/New_York",
    ),
  });
  await page.getByRole("button", { name: "Validate & stage import" }).waitFor();
  await page.screenshot({
    path: new URL("imports-desktop.png", out).pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Validate & stage import" }).click();
  await page
    .getByRole("heading", { name: "Import staged for review" })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("heading", { name: "Hello, Jordan." }).waitFor();
  await page.screenshot({
    path: new URL("dashboard-mobile.png", out).pathname,
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  await page.getByRole("heading", { name: "Example Home Services" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: new URL("focus-mobile.png", out).pathname,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("browser-results.json", out),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "desktop dashboard",
          "call form",
          "modal Escape",
          "import mapping and staging",
          "mobile dashboard and focus without horizontal overflow",
        ],
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser QA passed: desktop, mobile, call logging, import mapping, and modal keyboard handling.",
  );
} finally {
  await browser.close();
}
