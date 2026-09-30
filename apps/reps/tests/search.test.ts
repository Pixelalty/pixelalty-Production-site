import test from "node:test";
import assert from "node:assert/strict";
import { startIntegration } from "./integration-server";

test("business search preserves real punctuation without widening filters or bypassing RLS", async () => {
  const f = await startIntegration();
  try {
    const names = [
      "Example Towing & Recovery",
      "Demo Plumbing Co.",
      'O\'Neil, "Premier" (HVAC)',
      "100% Care_Clinic",
      "100X CareXClinic",
      "Path\\Works",
      "Ångström Services",
    ];
    for (const [i, name] of names.entries()) {
      await f.db.query(
        "insert into px_businesses(name,phone,timezone) values($1,$2,'America/New_York')",
        [name, "+1212555018" + i],
      );
    }
    const search = async (term: string, id = f.owner) => {
      const response = await fetch(
        f.base + "/api/table?name=businesses&q=" + encodeURIComponent(term),
        {
          headers: {
            authorization:
              "Bearer " +
              f.session(f.users.find((user) => user.id === id)).access_token,
          },
        },
      );
      assert.equal(response.status, 200);
      return (await response.json()) as { rows: Array<{ name: string }> };
    };
    for (const name of names) {
      assert.deepEqual(
        (await search(name)).rows.map((row) => row.name),
        [name],
      );
    }
    assert.deepEqual(
      (await search("%")).rows.map((row) => row.name),
      ["100% Care_Clinic"],
    );
    assert.deepEqual((await search('missing"),code.ilike.%')).rows, []);
    assert.deepEqual(
      (await search("Example Towing & Recovery", f.rep)).rows,
      [],
    );
  } finally {
    await f.close();
  }
});
