import { HttpError, type Env } from "./types";
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
