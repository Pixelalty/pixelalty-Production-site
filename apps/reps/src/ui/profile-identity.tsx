import { useEffect, useState, type CSSProperties } from "react";
import { defaultProfileStyle, type ProfileStyle } from "../shared/cosmetics";
import { profileImageBlob, useApp, useData } from "./lib";
import type { Row } from "../shared/core";

function useReducedMotion() {
  const app = useApp();
  const [reduced, set] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => set(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    reduced ||
    (app.displayPreferences || app.preferences).reduced_motion ||
    ["off", "reduced"].includes(
      (app.displayPreferences || app.preferences).motion,
    )
  );
}
function Asset({
  id,
  className,
  style,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion(),
    [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true,
      object = "";
    setUrl("");
    setFailed(false);
    profileImageBlob(id, reduced)
      .then((blob) => {
        if (active) {
          object = URL.createObjectURL(blob);
          setUrl(object);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [id, reduced]);
  return url ? (
    <img
      alt=""
      src={url}
      className={className}
      style={style}
      onError={() => {
        setUrl("");
        setFailed(true);
      }}
    />
  ) : failed ? (
    <span
      className="profile-media-unavailable"
      title="Profile image unavailable. Reload to try again."
    >
      !
    </span>
  ) : null;
}
export function ProfileAvatar({
  name,
  style: value,
  size = "small",
}: {
  name: string;
  style?: Partial<ProfileStyle>;
  size?: "small" | "large" | "preview";
}) {
  const p = { ...defaultProfileStyle, ...value };
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((v) => v[0])
      .slice(0, p.avatar === "monogram" ? 2 : 1)
      .join("") || "P";
  return (
    <span
      aria-hidden="true"
      className={`profile-avatar-v2 size-${size} cosmetic-avatar-${p.avatar} cosmetic-frame-${p.frame} profile-accent-${p.accent}`}
    >
      <span className="cosmetic-orbit" />
      <span className="cosmetic-orbit secondary" />
      <span className="avatar-face">
        {initials}
        {p.avatar_asset && (
          <Asset
            id={p.avatar_asset}
            style={{ objectPosition: `${p.avatar_x}% ${p.avatar_y}%` }}
          />
        )}
      </span>
    </span>
  );
}
export function ProfileBanner({
  style: value,
}: {
  style?: Partial<ProfileStyle>;
}) {
  const p = { ...defaultProfileStyle, ...value };
  return (
    <div
      aria-hidden="true"
      className={`profile-banner-v2 cosmetic-banner-${p.banner} profile-accent-${p.accent}`}
    >
      <i />
      <i />
      <i />
      {p.banner_asset && (
        <Asset
          id={p.banner_asset}
          style={{
            objectPosition: `${p.banner_x}% ${p.banner_y}%`,
            objectFit: p.banner_fit,
          }}
        />
      )}
    </div>
  );
}
export function ProfileSurface({
  rep,
  style,
}: {
  rep: Row;
  style?: Partial<ProfileStyle>;
}) {
  return (
    <section className="card profile-surface">
      <ProfileBanner style={style} />
      <div className="profile-surface-details">
        <ProfileAvatar name={rep.name} style={style} size="large" />
        <div>
          <h2>{rep.name}</h2>
          <p>{rep.code}</p>
          {rep.bio && <p>{rep.bio}</p>}
        </div>
      </div>
    </section>
  );
}
export function SharedIdentity({
  rep,
  surface = false,
}: {
  rep: Row;
  surface?: boolean;
}) {
  const app = useApp(),
    own = rep.id === app.ctx.rep?.id;
  const state = useData(
    !own && rep.id ? "/profile?rep=" + rep.id : null,
    30000,
  );
  const style = own ? app.ctx.profile?.style : state.data?.style;
  return surface ? (
    <ProfileSurface rep={rep} style={style} />
  ) : (
    <span className="shared-identity">
      <ProfileAvatar name={rep.name || "Pixelalty"} style={style} />
      <span>
        <strong>{rep.name}</strong>
        {rep.code && <small>{rep.code}</small>}
      </span>
    </span>
  );
}
