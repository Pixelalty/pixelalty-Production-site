import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workspacePreferences,
  defaultWorkspacePreferences,
} from "../src/shared/workspace";
import { workspacePages } from "../src/ui/navigation";

test("untrusted appearance metadata cannot add executable values or external navigation", () => {
  const p = workspacePreferences({
    theme: "url(javascript:alert(1))",
    accent: "red;display:none",
    pinned: [
      "//outside.test",
      "https://outside.test",
      "/admin/leads",
      "/admin/leads",
      "/?token=private",
      8,
    ],
    role: "owner",
    reduced_motion: "false",
  });
  assert.deepEqual(p, {
    ...defaultWorkspacePreferences,
    pinned: ["/admin/leads"],
  });
  assert.deepEqual(workspacePreferences(null), defaultWorkspacePreferences);
  assert.equal(
    workspacePreferences({
      pinned: Array.from(
        { length: 20 },
        (_, i) => "/" + String.fromCharCode(97 + i),
      ),
    }).pinned.length,
    6,
  );
});

test("navigation exposes one home and appearance to owner, active and onboarding accounts", () => {
  for (const ctx of [
    { roles: ["owner"], rep: null },
    { roles: ["owner"], rep: { status: "active" } },
    { roles: [], rep: { status: "active" } },
    { roles: [], rep: { status: "onboarding" } },
  ]) {
    const pages = workspacePages(ctx);
    assert.equal(pages.filter((p) => p.to === "/").length, 1);
    assert.equal(new Set(pages.map((p) => p.to)).size, pages.length);
    assert.ok(pages.some((p) => p.to === "/appearance"));
    if (ctx.roles.includes("owner"))
      assert.equal(
        pages.some((p) => p.to === "/admin"),
        !!ctx.rep,
      );
    if (!ctx.roles.length)
      assert.equal(pages.filter((p) => p.to.startsWith("/admin")).length, 0);
    if (ctx.rep?.status === "onboarding") {
      assert.ok(pages.some((p) => p.to === "/onboarding"));
      assert.equal(
        pages.some((p) => p.to === "/focus"),
        false,
      );
    }
  }
});

test("specialist navigation preserves role boundaries", () => {
  const finance = workspacePages({ roles: ["finance_admin"], rep: null });
  assert.ok(finance.some((p) => p.to === "/admin/finance"));
  assert.equal(
    finance.some((p) => p.to === "/admin/settings"),
    false,
  );
  assert.equal(
    finance.some((p) => p.to === "/admin/leads"),
    false,
  );
});
