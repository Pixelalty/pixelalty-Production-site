// Local preview of customer-site entry points and the actual generated emails.
// External destinations are intercepted; no production database is accessed.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const root = resolve("../.."),
  out = new URL("../test-results/auth/", import.meta.url);
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url!, "http://127.0.0.1").pathname;
    if (!extname(path)) path = path.replace(/\/$/, "") + "/index.html";
    const file = resolve(root, "." + path);
    if (!file.startsWith(root + "/")) throw Error("Unavailable");
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type":
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
            ".webp": "image/webp",
            ".png": "image/png",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(file)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + (server.address() as any).port;
const browser = await chromium.launch({
  executablePath: process.env.PIXELALTY_CHROMIUM_PATH || undefined,
  args: process.env.PIXELALTY_CHROMIUM_ARGS
    ? JSON.parse(process.env.PIXELALTY_CHROMIUM_ARGS)
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.route("https://*.supabase.co/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: route.request().url().includes("public_review_count") ? "0" : "[]",
    }),
  );
  await page.route("https://join.pixelalty.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Verified recruiting destination</h1>",
    }),
  );
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    const link = page.getByRole("link", {
      name: "Join Pixelalty",
      exact: true,
    });
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), "https://join.pixelalty.com");
    assert.equal(await link.count(), 1);
    const careers = page.getByRole("link", {
      name: "Explore sales opportunities",
      exact: false,
    });
    await careers.waitFor();
    assert.equal(
      await careers.getAttribute("href"),
      "https://join.pixelalty.com",
    );
    await page.locator(".join-pixelalty").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: new URL("customer-careers-" + width + ".png", out).pathname,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (width === 390) {
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      assert.equal(
        await page.locator(".menu-toggle").getAttribute("aria-expanded"),
        "true",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".menu-toggle").getAttribute("aria-expanded"),
        "false",
      );
    }
  }
  await page.getByRole("link", { name: "Join Pixelalty", exact: true }).click();
  assert.equal(new URL(page.url()).origin, "https://join.pixelalty.com");
  await page.goto(base + "/apply");
  await page.waitForURL("https://join.pixelalty.com/");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({
      width: theme === "light" ? 760 : 390,
      height: 940,
    });
    await page.goto(base + "/apps/reps/supabase/templates/invite.html");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.match(
      (await page
        .getByRole("link", { name: "SET UP YOUR PIXELALTY ACCOUNT" })
        .getAttribute("href"))!,
      /^https:\/\/reps.pixelalty.com\/auth\/confirm#token_hash=/,
    );
    await page.screenshot({
      path: new URL(`invite-email-${theme}.png`, out).pathname,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  const result = {
    checks: [
      "Customer footer entry and mobile menu at 390/768/1440",
      "Join link and /apply redirect target",
      "Generated invitation HTML in desktop light and mobile dark",
    ],
    runtimeErrors: errors,
    externalDelivery: "Not tested",
  };
  await writeFile(
    new URL("branding-results.json", out),
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
}
