import { useEffect, useState } from "react";
import { Check, LockKeyhole, ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { api, Card, Modal, State, useApp, useData } from "./lib";
import {
  cosmeticCatalog,
  cosmeticTiers,
  defaultProfileStyle,
  profileStyle,
  mediaUnlock,
  type Cosmetic,
  type CosmeticKind,
  type ProfileStyle,
} from "../shared/cosmetics";
import { inspectProfileImage } from "../shared/profile-media";
import {
  ProfileAvatar,
  ProfileBanner,
  ProfileSurface,
} from "./profile-identity";
import type { Row } from "../shared/core";

// Decode in the browser before upload and provide a bounded, non-animated
// equivalent. The Worker independently validates both files before Storage.
export async function staticImage(file: File): Promise<File> {
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw Error("This image could not be read. Export it again and retry.");
    const scale = Math.min(
        1,
        1200 / image.naturalWidth,
        1200 / image.naturalHeight,
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context)
      throw Error("Image preparation is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(Error("Image preview could not be prepared.")),
        "image/png",
      ),
    );
    return new File([blob], "still.png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function ProfileStudio() {
  const app = useApp(),
    data = useData("/profile", 15000),
    rep = app.ctx.rep;
  const [draft, setDraft] = useState<ProfileStyle>(
    profileStyle(app.ctx.profile?.style),
  );
  const [kind, setKind] = useState<CosmeticKind>("avatar"),
    [tier, setTier] = useState(0),
    [preview, setPreview] = useState<{
      kind: CosmeticKind;
      item: Cosmetic;
    } | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [candidate, setCandidate] = useState<{
      file: File;
      still: File;
      url: string;
      kind: "avatar" | "banner";
      animated: boolean;
    } | null>(null);
  useEffect(
    () => () => {
      if (candidate) URL.revokeObjectURL(candidate.url);
    },
    [candidate],
  );
  const earned = Number(
      data.data?.earned_xp ?? app.ctx.profile?.earned_xp ?? 0,
    ),
    xp = Number(app.ctx.career_xp || 0);
  const saved = profileStyle(data.data?.style || app.ctx.profile?.style);
  const change = (p: Partial<ProfileStyle>) => {
    setDraft((d) => ({ ...d, ...p }));
    setNotice("");
    setError("");
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const operation = async (title: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(title);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const equip = (k: CosmeticKind, c: Cosmetic) => {
    change({ [k]: c.id, ...(k !== "frame" ? { [k + "_asset"]: null } : {}) });
    setPreview(null);
  };
  const chooseFile = async (file: File, k: "avatar" | "banner") =>
    operation("Preparing image", async () => {
      const info = inspectProfileImage(
          new Uint8Array(await file.arrayBuffer()),
          file.type,
          file.name,
        ),
        need = mediaUnlock(k, info.animated);
      if (earned < need)
        throw Error(
          `This upload unlocks at ${need.toLocaleString()} career XP.`,
        );
      const still = await staticImage(file);
      setCandidate({
        file,
        still,
        kind: k,
        animated: info.animated,
        url: URL.createObjectURL(still),
      });
    });
  const assets: Row[] = data.data?.assets || [];
  return (
    <div className="profile-studio">
      <div className="studio-preview">
        <ProfileSurface rep={rep} style={draft} />
        <div className="studio-summary">
          <Sparkles size={19} />
          <span>
            <strong>{xp.toLocaleString()} career XP</strong>
            <small>
              Unlocks earned through {earned.toLocaleString()} XP. Earned styles
              stay unlocked after corrections.
            </small>
          </span>
        </div>
      </div>
      <State error={data.error || error} />
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status" className="notice">
          {busy}…
        </p>
      )}
      <div className="studio-controls">
        <div className="segmented" aria-label="Profile element">
          {(["avatar", "frame", "banner"] as CosmeticKind[]).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
        <label className="field">
          Profile accent
          <select
            value={draft.accent}
            onChange={(e) => change({ accent: e.target.value })}
          >
            {["blue", "emerald", "violet", "rose", "amber", "slate"].map(
              (v) => (
                <option key={v} value={v}>
                  {v[0].toUpperCase() + v.slice(1)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <div className="cosmetic-tiers" aria-label="Unlock tier">
        {cosmeticTiers.map((t) => (
          <button key={t} aria-pressed={tier === t} onClick={() => setTier(t)}>
            {earned < t ? <LockKeyhole size={14} /> : <Check size={14} />}{" "}
            {t === 0 ? "Essentials" : t.toLocaleString() + " XP"}
          </button>
        ))}
      </div>
      <div className="cosmetic-gallery">
        {cosmeticCatalog[kind]
          .filter((c) => c.xp === tier)
          .map((c) => {
            const locked = earned < c.xp,
              style = {
                ...draft,
                [kind]: c.id,
                avatar_asset: null,
                banner_asset: null,
              };
            return (
              <button
                className={
                  "cosmetic-tile " + (draft[kind] === c.id ? "selected" : "")
                }
                key={kind + c.id}
                aria-label={`${c.name} ${kind}${locked ? " — locked at " + c.xp.toLocaleString() + " XP" : ""}`}
                onClick={() => setPreview({ kind, item: c })}
              >
                <span className="cosmetic-swatch">
                  {kind === "banner" ? (
                    <ProfileBanner style={style} />
                  ) : (
                    <ProfileAvatar
                      name={rep.name}
                      style={style}
                      size="preview"
                    />
                  )}
                </span>
                <strong>{c.name}</strong>
                <span className="cosmetic-status">
                  {locked ? (
                    <LockKeyhole size={13} />
                  ) : draft[kind] === c.id ? (
                    <Check size={13} />
                  ) : c.animated ? (
                    <Sparkles size={13} />
                  ) : null}
                  {locked
                    ? `${c.xp.toLocaleString()} XP required`
                    : draft[kind] === c.id
                      ? "Selected"
                      : c.animated
                        ? "Animated"
                        : "Unlocked"}
                </span>
                {locked && (
                  <>
                    <progress
                      aria-label={c.name + " unlock progress"}
                      value={Math.min(Math.max(0, xp), c.xp)}
                      max={c.xp}
                    />
                    <small>
                      {xp.toLocaleString()} / {c.xp.toLocaleString()} XP
                    </small>
                  </>
                )}
              </button>
            );
          })}
      </div>
      {kind !== "frame" && (
        <Card
          title={kind === "avatar" ? "Your own avatar" : "Your own banner"}
          extra={<ImagePlus size={20} />}
        >
          <p>
            JPG, PNG, WebP or GIF · up to 5 MB · 32–4,096 pixels per side.
            Static uploads unlock at 1,000 XP; animated {kind}s at{" "}
            {mediaUnlock(kind, true).toLocaleString()} XP.
          </p>
          <label className="field">
            Choose {kind} image
            <input
              aria-label={"Choose " + kind + " image"}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={Boolean(busy) || earned < 1000}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void chooseFile(file, kind);
                e.target.value = "";
              }}
            />
          </label>
          {earned < 1000 && (
            <p className="notice">
              <LockKeyhole size={15} /> {xp.toLocaleString()} / 1,000 XP.
              Preview the presets while you build your career.
            </p>
          )}
          {assets.filter((a) => a.kind === kind).length > 0 && (
            <div className="media-library">
              {assets
                .filter((a) => a.kind === kind)
                .map((a) => (
                  <div key={a.id} className="media-item">
                    <button
                      aria-pressed={
                        draft[
                          kind === "avatar" ? "avatar_asset" : "banner_asset"
                        ] === a.id
                      }
                      onClick={() => change({ [kind + "_asset"]: a.id })}
                      aria-label={
                        "Use uploaded " +
                        kind +
                        " from " +
                        new Date(a.created_at).toLocaleString()
                      }
                    >
                      {kind === "avatar" ? (
                        <ProfileAvatar
                          name={rep.name}
                          style={{ ...draft, avatar_asset: a.id }}
                          size="preview"
                        />
                      ) : (
                        <ProfileBanner
                          style={{ ...draft, banner_asset: a.id }}
                        />
                      )}
                      <small>
                        {a.animated ? "Animated" : "Static"} · {a.width} ×{" "}
                        {a.height}
                      </small>
                    </button>
                    <button
                      aria-label="Delete uploaded image"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void operation("Removing image", async () => {
                          await api("/profile/remove", { id: a.id });
                          setDraft((d) => ({
                            ...d,
                            avatar_asset:
                              d.avatar_asset === a.id ? null : d.avatar_asset,
                            banner_asset:
                              d.banner_asset === a.id ? null : d.banner_asset,
                          }));
                          await app.reloadContext();
                          app.refresh();
                          setNotice(
                            "Image removed from your profile and file storage.",
                          );
                        })
                      }
                    >
                      <Trash2 size={16} /> Remove
                    </button>
                  </div>
                ))}
            </div>
          )}
          {draft[kind === "avatar" ? "avatar_asset" : "banner_asset"] && (
            <div className="media-position">
              <p>
                Position the image inside its frame. Preview above, then save
                your profile.
              </p>
              {(["x", "y"] as const).map((axis) => (
                <label key={axis} className="field">
                  {axis === "x" ? "Horizontal" : "Vertical"} position
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={draft[(kind + "_" + axis) as "avatar_x"]}
                    onChange={(e) =>
                      change({ [kind + "_" + axis]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              {kind === "banner" && (
                <label className="field">
                  Banner fit
                  <select
                    value={draft.banner_fit}
                    onChange={(e) =>
                      change({
                        banner_fit: e.target.value as "cover" | "contain",
                      })
                    }
                  >
                    <option value="cover">Fill & crop</option>
                    <option value="contain">Fit entire image</option>
                  </select>
                </label>
              )}
              <button onClick={() => change({ [kind + "_asset"]: null })}>
                Use preset instead
              </button>
            </div>
          )}
        </Card>
      )}
      <div className="preference-savebar">
        <span className="muted">
          {dirty
            ? "Previewing unsaved profile changes"
            : "Your profile is saved"}
        </span>
        <div className="actions">
          <button
            disabled={Boolean(busy)}
            onClick={() => change({ ...defaultProfileStyle })}
          >
            Reset profile
          </button>
          {dirty && (
            <button
              disabled={Boolean(busy)}
              onClick={() => {
                setDraft(saved);
                setError("");
              }}
            >
              Cancel changes
            </button>
          )}
          <button
            className="primary"
            disabled={Boolean(busy) || !dirty}
            onClick={() =>
              void operation("Saving profile", async () => {
                await api("/profile", { style: draft });
                await app.reloadContext();
                app.refresh();
                setNotice("Profile saved. Your team will see your new look.");
              })
            }
          >
            Save profile appearance
          </button>
        </div>
      </div>
      {preview && (
        <Modal
          title={preview.item.name + " " + preview.kind}
          onClose={() => setPreview(null)}
        >
          <ProfileSurface
            rep={rep}
            style={{
              ...draft,
              [preview.kind]: preview.item.id,
              avatar_asset: null,
              banner_asset: null,
            }}
          />
          {earned < preview.item.xp ? (
            <>
              <p>
                <LockKeyhole size={16} /> Unlocks at{" "}
                {preview.item.xp.toLocaleString()} career XP. You currently have{" "}
                {xp.toLocaleString()} XP.
              </p>
              <progress
                aria-label="Progress toward unlock"
                value={Math.min(Math.max(0, xp), preview.item.xp)}
                max={preview.item.xp}
              />
              <button disabled>
                Earn {(preview.item.xp - Math.max(0, xp)).toLocaleString()} more
                XP to equip
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => equip(preview.kind, preview.item)}
            >
              Select {preview.item.name}
            </button>
          )}
        </Modal>
      )}
      {candidate && (
        <Modal
          title={"Preview your " + candidate.kind}
          onClose={() => setCandidate(null)}
        >
          <img
            className={"upload-preview upload-preview-" + candidate.kind}
            src={candidate.url}
            alt="Image preview before upload"
          />
          <p>
            {candidate.animated
              ? "The original will animate with full motion. This still image is used when motion is reduced."
              : "This image is ready to upload."}{" "}
            You can position it before saving your profile.
          </p>
          <button
            className="primary"
            disabled={Boolean(busy)}
            onClick={() =>
              void operation("Uploading image", async () => {
                const form = new FormData();
                form.set("image", candidate.file);
                form.set("still", candidate.still);
                form.set("kind", candidate.kind);
                const out = await api("/profile/upload", form);
                setDraft((d) => ({
                  ...d,
                  [candidate.kind + "_asset"]: out.id,
                }));
                setCandidate(null);
                app.refresh();
                setNotice(
                  "Upload complete. Position your image, then save your profile.",
                );
              })
            }
          >
            {busy ? "Uploading…" : "Upload image"}
          </button>
        </Modal>
      )}
    </div>
  );
}
