import test from "node:test";
import assert from "node:assert/strict";
import { profileImages } from "./fixtures/profile-images";
import {
  inspectProfileImage,
  PROFILE_MAX_BYTES,
} from "../src/shared/profile-media";
import {
  cosmeticCatalog,
  defaultProfileStyle,
  profileStyle,
} from "../src/shared/cosmetics";
import { careerProgress } from "../src/shared/progression";
import { scheduledInstant, timezoneOptions } from "../src/shared/timezones";
import { workspacePreferences } from "../src/shared/workspace";
import { actor, database, rpc } from "./helpers";
import { startIntegration } from "./integration-server";
import { expireProfileMedia } from "../src/server/profile";

test("career progress preserves fixed level intervals across awards, multiple levels and corrections", () => {
  assert.deepEqual(careerProgress(275), {
    xp: 275,
    step: 250,
    level: 2,
    minimum: 250,
    next: 500,
    within: 25,
    remaining: 225,
    percent: 10,
  });
  const large = careerProgress(1000274);
  assert.equal(large.level, 4002);
  assert.equal(large.within, 24);
  assert.equal(careerProgress(999, 1000).percent, 99.9);
  assert.equal(careerProgress(1000, 1000).within, 0);
  assert.equal(careerProgress(-25).level, 1);
  assert.equal(careerProgress(-25).within, 0);
});
test("friendly US time zones persist IANA values and resolve both DST transitions explicitly", () => {
  assert.ok(timezoneOptions().some((x) => x.value === "America/Phoenix"));
  assert.ok(timezoneOptions("UTC").some((x) => x.value === "UTC"));
  assert.equal(
    scheduledInstant("2026-03-08T03:30", "America/New_York"),
    "2026-03-08T07:30:00.000Z",
  );
  assert.throws(
    () => scheduledInstant("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.equal(
    scheduledInstant("2026-11-01T01:30", "America/New_York", "earlier"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(
    scheduledInstant("2026-11-01T01:30", "America/New_York", "later"),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    scheduledInstant("2026-07-01T12:00", "America/Phoenix"),
    "2026-07-01T19:00:00.000Z",
  );
  assert.throws(() => scheduledInstant("2026-02-30T12:00", "America/New_York"));
});
test("bounded preferences preserve section expansion and reject executable or unknown values", () => {
  const p = workspacePreferences({
    navigation_open: ["My sales", "Resources", "My sales", "<script>"],
    navigation_mode: "single",
    font: "url(secret)",
    content_width: "wide",
    motion: "premium",
  });
  assert.deepEqual(p.navigation_open, ["My sales", "Resources"]);
  assert.equal(p.font, "sans");
  assert.equal(p.motion, "premium");
  assert.equal(p.content_width, "wide");
  assert.deepEqual(
    profileStyle({ ...defaultProfileStyle, updated_at: "ignored" } as any),
    defaultProfileStyle,
  );
});
test("profile media validates real files, container corruption, disguise, animation and bounds", () => {
  for (const [key, data] of Object.entries(profileImages)) {
    const format = key === "animated_webp" ? "webp" : key,
      mime = "image/" + (format === "jpg" ? "jpeg" : format),
      bytes = Buffer.from(data, "base64");
    const info = inspectProfileImage(bytes, mime, "profile." + format);
    assert.equal(info.width, 64);
    assert.equal(info.height, 64);
    assert.equal(info.animated, ["gif", "animated_webp"].includes(key));
    assert.throws(() =>
      inspectProfileImage(bytes.subarray(0, -8), mime, "profile." + format),
    );
    assert.throws(() =>
      inspectProfileImage(bytes, "image/svg+xml", "profile.svg"),
    );
  }
  assert.throws(() =>
    inspectProfileImage(
      Buffer.from("<script>alert(1)</script>"),
      "image/jpeg",
      "fake.jpg",
    ),
  );
  assert.throws(
    () =>
      inspectProfileImage(
        new Uint8Array(PROFILE_MAX_BYTES + 1),
        "image/png",
        "large.png",
      ),
    /5 MB/,
  );
  const corrupt = Buffer.from(profileImages.png, "base64");
  corrupt[20] ^= 3;
  assert.throws(() => inspectProfileImage(corrupt, "image/png", "broken.png"));
  const spoof = Buffer.from(profileImages.animated_webp, "base64");
  spoof[20] &= ~2;
  assert.equal(
    inspectProfileImage(spoof, "image/webp", "spoof.webp").animated,
    true,
  );
});

test("every cosmetic is enforced by SQL; peak unlocks survive a correction and metadata cannot bypass gates", async () => {
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    other = crypto.randomUUID();
  try {
    for (const id of [owner, rep, other]) {
      await db.query("insert into auth.users values($1,$2,now())", [
        id,
        id + "@example.test",
      ]);
      await db.query(
        "insert into px_reps(id,name,status) values($1,'Profile test','active')",
        [id],
      );
      await db.query("insert into px_rep_private(rep_id,email) values($1,$2)", [
        id,
        id + "@example.test",
      ]);
    }
    await db.query("insert into px_roles values($1,'owner')", [owner]);
    for (const [kind, items] of Object.entries(cosmeticCatalog))
      for (const item of items) {
        const q = await db.query<any>(
          "select px_private.cosmetic_xp($1,$2) n",
          [kind, item.id],
        );
        assert.equal(q.rows[0].n, item.xp);
      }
    await actor(db, rep);
    for (const frame of ["accent_ring", "pulse", "holographic"])
      await assert.rejects(
        rpc(db, "px_profile", "save", {
          style: { ...defaultProfileStyle, frame },
          earned_xp: 999999,
        }),
        /locked/,
      );
    await assert.rejects(
      rpc(db, "px_profile", "save", {
        rep_id: other,
        style: defaultProfileStyle,
      }),
      /own/,
    );
    await assert.rejects(
      db.query(
        "update px_profile_styles set earned_xp=999999 where rep_id=$1",
        [rep],
      ),
      /permission/,
    );
    await assert.rejects(
      rpc(db, "px_profile", "save", {
        style: { ...defaultProfileStyle, frame: "<script>" },
      }),
      /available/,
    );
    await actor(db, owner, "aal2");
    const adjustment = {
      id: rep,
      amount: 50000,
      request_id: crypto.randomUUID(),
      reason: "Verified award for test milestones",
    };
    await rpc(db, "px_action", "xp_adjust", adjustment);
    await rpc(db, "px_action", "xp_adjust", adjustment);
    await actor(db, rep);
    assert.equal((await rpc(db, "px_profile", "summary")).earned_xp, 50000);
    await rpc(db, "px_profile", "save", {
      style: { ...defaultProfileStyle, frame: "holographic" },
    });
    await actor(db, owner, "aal2");
    await rpc(db, "px_action", "xp_adjust", {
      ...adjustment,
      amount: -10000,
      request_id: crypto.randomUUID(),
      reason: "Correct the test milestone amount",
    });
    await actor(db, rep);
    const state = await rpc(db, "px_profile", "summary");
    assert.equal(state.earned_xp, 50000);
    assert.equal(state.lifetime_xp, 40000);
    assert.equal(state.style.frame, "holographic");
    await rpc(db, "px_profile", "save", {
      style: { ...defaultProfileStyle, banner: "aurora" },
    });
    await actor(db, other);
    assert.equal(
      (await rpc(db, "px_profile", "summary", { rep_id: rep })).style.banner,
      "aurora",
    );
    await assert.rejects(
      rpc(db, "px_profile", "moderate", {
        rep_id: rep,
        reason: "Not an administrator",
      }),
      /MFA|authorized/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into auth.mfa_factors(user_id,status) values($1,'verified')",
      [rep],
    );
    await actor(db, rep);
    const challenge = (await db.query<any>("select px_context() as result"))
      .rows[0].result;
    assert.equal(challenge.rep, null);
    assert.equal(challenge.mfa_required, true);
    assert.equal(challenge.settings, undefined);
    assert.equal(challenge.profile, undefined);
    assert.equal(
      (await db.query("select * from px_profile_styles")).rows.length,
      0,
    );
    await assert.rejects(rpc(db, "px_profile", "summary"), /authenticator/);
    await assert.rejects(
      rpc(db, "px_action", "preferences", { value: {} }),
      /authenticator/,
    );
    await assert.rejects(rpc(db, "px_report", "dashboard"), /authenticator/);
    await actor(db, rep, "aal2");
    assert.equal(
      (await rpc(db, "px_profile", "summary")).style.banner,
      "aurora",
    );
  } finally {
    await db.close();
  }
});

const headers = (
  f: Awaited<ReturnType<typeof startIntegration>>,
  id: string,
) => ({
  authorization:
    "Bearer " + f.session(f.users.find((u) => u.id === id)).access_token,
  origin: f.base,
});
const post = (
  f: Awaited<ReturnType<typeof startIntegration>>,
  id: string,
  path: string,
  p: unknown,
) =>
  fetch(f.base + "/api" + path, {
    method: "POST",
    headers: { ...headers(f, id), "content-type": "application/json" },
    body: JSON.stringify(p),
  });
test("Worker media upload, owned references, shared visibility, removal and deletion preserve private storage", async () => {
  const f = await startIntegration();
  try {
    const upload = async (
      id: string,
      kind: string,
      image = profileImages.png,
      format = "png",
    ) => {
      const form = new FormData();
      form.set("kind", kind);
      form.set(
        "image",
        new Blob([Buffer.from(image, "base64")], {
          type: "image/" + (format === "jpg" ? "jpeg" : format),
        }),
        "profile." + format,
      );
      form.set(
        "still",
        new Blob([Buffer.from(profileImages.png, "base64")], {
          type: "image/png",
        }),
        "still.png",
      );
      return fetch(f.base + "/api/profile/upload", {
        method: "POST",
        headers: headers(f, id),
        body: form,
      });
    };
    assert.equal((await upload(f.rep, "avatar")).status, 403);
    assert.equal((await post(f, f.rep, "/profile/upload", {})).status, 400);
    await post(f, f.owner, "/action", {
      action: "xp_adjust",
      p: {
        id: f.rep,
        amount: 50000,
        request_id: crypto.randomUUID(),
        reason: "Profile media acceptance fixture",
      },
    });
    for (const [image, format] of [
      [profileImages.jpg, "jpg"],
      [profileImages.webp, "webp"],
      [profileImages.gif, "gif"],
      [profileImages.animated_webp, "webp"],
    ]) {
      const response = await upload(f.rep, "avatar", image, format);
      assert.equal(response.status, 200, await response.clone().text());
    }
    const response = await upload(f.rep, "banner");
    assert.equal(response.status, 200, await response.clone().text());
    const asset = (await response.json()) as any;
    assert.equal(
      (
        await fetch(f.base + "/api/profile/media/" + asset.id, {
          headers: headers(f, f.newRep),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(f, f.newRep, "/profile", {
          style: { ...defaultProfileStyle, banner_asset: asset.id },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(f, f.rep, "/profile", {
          style: { ...defaultProfileStyle, banner_asset: asset.id },
        })
      ).status,
      200,
    );
    const visible = await fetch(
      f.base + "/api/profile/media/" + asset.id + "?still=true",
      { headers: headers(f, f.newRep) },
    );
    assert.equal(visible.status, 200);
    assert.equal(visible.headers.get("content-type"), "image/png");
    assert.match(visible.headers.get("cache-control") || "", /no-store/);
    assert.equal(
      (await fetch(f.base + "/api/profile/media/" + asset.id)).status,
      401,
    );
    await post(f, f.newRep, "/profile/remove", { id: asset.id });
    assert.equal(
      (
        await fetch(f.base + "/api/profile/media/" + asset.id, {
          headers: headers(f, f.rep),
        })
      ).status,
      200,
    );
    await post(f, f.owner, "/profile/moderate", {
      rep_id: f.rep,
      reason: "Remove images after moderation review",
    });
    assert.equal(
      (
        await fetch(f.base + "/api/profile/media/" + asset.id, {
          headers: headers(f, f.rep),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*) n from px_private.profile_assets",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*) n from storage.objects where bucket_id='pixelalty-profile-media'",
        )
      ).rows[0].n,
      0,
    );
    await actor(f.db, f.rep);
    const stale = await rpc(f.db, "px_profile", "reserve", {
      kind: "avatar",
      mime: "image/png",
      width: 64,
      height: 64,
      bytes: 200,
      animated: false,
    });
    const recent = await rpc(f.db, "px_profile", "reserve", {
      kind: "avatar",
      mime: "image/png",
      width: 64,
      height: 64,
      bytes: 200,
      animated: false,
    });
    await f.db.exec("reset role");
    await f.db.query(
      "update px_private.profile_assets set created_at=now()-interval '25 hours' where id=$1",
      [stale.id],
    );
    await f.db.query(
      "insert into storage.objects(bucket_id,name) values('pixelalty-profile-media',$1)",
      [stale.object_key],
    );
    f.storedFiles.set(
      "pixelalty-profile-media/" + stale.object_key,
      Buffer.from(profileImages.png, "base64"),
    );
    await expireProfileMedia(f.env);
    assert.equal(
      (
        await f.db.query(
          "select id from px_private.profile_assets where id=$1",
          [stale.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "select id from px_private.profile_assets where id=$1",
          [recent.id],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await f.db.query("select id from storage.objects where name=$1", [
          stale.object_key,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("public application approval and permanent deletion remove recruiting, Auth, profile media and invitations together", async () => {
  const f = await startIntegration();
  try {
    const application = await fetch(f.base + "/api/apply", {
      method: "POST",
      headers: { origin: f.base, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Lifecycle acceptance",
        email: "lifecycle@example.test",
        phone: "+13035550199",
        state: "Colorado",
        country: "United States",
        timezone: "America/Denver",
        age_confirmed: true,
        compensation_ack: true,
        outbound_ready: true,
        computer: true,
        internet: true,
        headset: true,
        experience: "Test applicant",
        availability: 20,
        motivation: "Testing the complete account lifecycle",
        token: "isolated-turnstile",
      }),
    });
    assert.equal(application.status, 200, await application.clone().text());
    const applicant = (
      await f.db.query<any>(
        "select id from px_applicants where email='lifecycle@example.test'",
      )
    ).rows[0];
    const approved = await post(f, f.owner, "/approve", {
      id: applicant.id,
      reason: "Approve isolated lifecycle acceptance",
    });
    assert.equal(approved.status, 200, await approved.clone().text());
    const who = ((await approved.json()) as any).rep_id;
    assert.ok(who);
    assert.equal(
      (
        await f.db.query<any>("select rep_id from px_applicants where id=$1", [
          applicant.id,
        ])
      ).rows[0].rep_id,
      who,
    );
    const rep = (
      await f.db.query<any>("select code from px_reps where id=$1", [who])
    ).rows[0];
    assert.ok(rep);
    await post(f, f.owner, "/action", {
      action: "xp_adjust",
      p: {
        id: who,
        amount: 1000,
        request_id: crypto.randomUUID(),
        reason: "Isolated media lifecycle award",
      },
    });
    const form = new FormData();
    for (const name of ["image", "still"])
      form.set(
        name,
        new Blob([Buffer.from(profileImages.png, "base64")], {
          type: "image/png",
        }),
        "profile.png",
      );
    form.set("kind", "avatar");
    const uploaded = await fetch(f.base + "/api/profile/upload", {
      method: "POST",
      headers: headers(f, who),
      body: form,
    });
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const oldToken = headers(f, who);
    const auditBefore = (
      await f.db.query<any>("select count(*) n from px_audit")
    ).rows[0].n;
    const deleted = await post(f, f.owner, "/account/delete", {
      id: who,
      confirmation: "DELETE " + rep.code,
      reason: "Remove completed isolated test identity",
    });
    assert.equal(deleted.status, 200, await deleted.clone().text());
    assert.equal(((await deleted.json()) as any).mode, "purge");
    for (const [table, key] of [
      ["auth.users", "id"],
      ["px_reps", "id"],
      ["px_applicants", "rep_id"],
      ["px_rep_private", "rep_id"],
      ["px_profile_styles", "rep_id"],
      ["px_private.profile_assets", "rep_id"],
      ["px_private.mail_outbox", "rep_id"],
    ])
      assert.equal(
        (
          await f.db.query<any>(
            `select count(*) n from ${table} where ${key}=$1`,
            [who],
          )
        ).rows[0].n,
        0,
        table,
      );
    assert.equal(
      (await fetch(f.base + "/api/me", { headers: oldToken })).status,
      401,
    );
    const login = await fetch(f.base + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "lifecycle@example.test",
        password: "Valid-password-123",
      }),
    });
    assert.equal(login.status, 400);
    assert.ok(
      (await f.db.query<any>("select count(*) n from px_audit")).rows[0].n >
        auditBefore,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*) n from storage.objects where bucket_id='pixelalty-profile-media'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await f.close();
  }
});
