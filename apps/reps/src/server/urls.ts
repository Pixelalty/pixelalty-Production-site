import { HttpError, type Env } from "./types";
import { readAuthLink } from "../shared/auth";
const loopback = (u: URL) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
export function deploymentUrls(env: Env, requestUrl: string) {
  const request = new URL(requestUrl);
  const parse = (value: string) => {
    try {
      const url = new URL(value);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && loopback(url) && loopback(request))) ||
        (loopback(url) && !loopback(request))
      )
        throw Error("Invalid URL");
      return url;
    } catch {
      throw new HttpError(
        503,
        "Pixelalty is temporarily unavailable. Please try again later.",
      );
    }
  };
  const app = parse(env.APP_URL);
  if (app.pathname !== "/")
    throw new HttpError(
      503,
      "Pixelalty is temporarily unavailable. Please try again later.",
    );
  const recruiting = parse(env.RECRUITING_URL || app.origin + "/apply");
  const internal =
    env.STRIPE_MODE === "test" && env.INTERNAL_APP_ORIGIN
      ? parse(env.INTERNAL_APP_ORIGIN).origin
      : "";
  return {
    app: app.origin,
    recruiting: recruiting.href.replace(/\/$/, ""),
    recruitingOrigin: recruiting.origin,
    internal,
  };
}
export function mutationOriginAllowed(req: Request, env: Env, path: string) {
  const urls = deploymentUrls(env, req.url),
    origin = req.headers.get("origin"),
    requestOrigin = new URL(req.url).origin;
  if (!origin || origin !== requestOrigin) return false;
  if (origin === urls.app || origin === urls.internal) return true;
  return path === "/api/apply" && origin === urls.recruitingOrigin;
}

// Keep owned destinations fixed, preserve application navigation, and carry any
// legacy query credentials only in a fragment until the callback consumes them.
// Fragments never reach the destination server or its access logs.
export function canonicalLocation(
  source: URL,
  target: string,
  path = source.pathname,
) {
  const { link, cleanPath } = readAuthLink(source);
  const clean = new URL("https://navigation.invalid" + cleanPath);
  const destination = new URL(target);
  destination.pathname = path;
  destination.search = clean.search;
  if (link) {
    const fragment = new URLSearchParams({ type: link.type });
    if (link.invalid) fragment.set("error", "invalid_link");
    else if (link.tokenHash) fragment.set("token_hash", link.tokenHash);
    else if (link.code) fragment.set("code", link.code);
    else if (link.accessToken && link.refreshToken) {
      fragment.set("access_token", link.accessToken);
      fragment.set("refresh_token", link.refreshToken);
    }
    destination.hash = fragment.toString();
  }
  return destination.href;
}
