export type EmailLinkType =
  | "invite"
  | "recovery"
  | "email"
  | "signup"
  | "email_change"
  | "magiclink";
export type AuthLink = {
  type: EmailLinkType;
  tokenHash?: string;
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  invalid?: boolean;
};
const emailTypes: EmailLinkType[] = [
  "invite",
  "recovery",
  "email",
  "signup",
  "email_change",
  "magiclink",
];
const sensitive = [
  "token_hash",
  "token",
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "token_type",
  "code",
  "type",
  "error",
  "error_code",
  "error_description",
  "email",
  "redirect_to",
  "next",
];

// Capture credentials once in memory, then remove them from the address/history.
// Caller-controlled next/redirect_to destinations are deliberately never followed.
export function readAuthLink(url: URL): {
  link: AuthLink | null;
  cleanPath: string;
} {
  const params = new URLSearchParams(url.search),
    fragment = new URLSearchParams(url.hash.slice(1));
  const get = (key: string) => fragment.get(key) || params.get(key) || "";
  const callback = ["/auth/confirm", "/auth/callback"].includes(url.pathname);
  const present =
    callback ||
    [
      "token_hash",
      "access_token",
      "refresh_token",
      "code",
      "error",
      "error_code",
    ].some((k) => get(k));
  const rawType =
    get("type") ||
    (url.pathname === "/welcome"
      ? "invite"
      : url.pathname === "/recover"
        ? "recovery"
        : "email");
  const type = emailTypes.includes(rawType as EmailLinkType)
    ? (rawType as EmailLinkType)
    : "email";
  const link: AuthLink | null = present ? { type } : null;
  if (link) {
    if (
      get("error") ||
      get("error_code") ||
      !emailTypes.includes(rawType as EmailLinkType)
    )
      link.invalid = true;
    else if (/^[a-zA-Z0-9_-]{20,2048}$/.test(get("token_hash")))
      link.tokenHash = get("token_hash");
    else if (/^[a-zA-Z0-9_.~-]{10,2048}$/.test(get("code")))
      link.code = get("code");
    else if (
      get("access_token").length < 12000 &&
      get("access_token").split(".").length === 3 &&
      /^[a-zA-Z0-9_.~-]{8,2048}$/.test(get("refresh_token"))
    ) {
      link.accessToken = get("access_token");
      link.refreshToken = get("refresh_token");
    } else link.invalid = true;
  }
  for (const key of sensitive) params.delete(key);
  const query = params.toString();
  const privateFragment = sensitive.some((key) => fragment.has(key));
  return {
    link,
    cleanPath:
      url.pathname +
      (query ? "?" + query : "") +
      (present || privateFragment ? "" : url.hash),
  };
}

export function authErrorMessage(
  error: unknown,
  fallback = "We couldn’t complete this step. Please try again or contact Pixelalty support.",
) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const messages: Record<string, string> = {
    invalid_credentials:
      "The email or password is incorrect. Please try again.",
    email_not_confirmed:
      "Confirm your email using the Pixelalty email we sent before signing in.",
    otp_expired:
      "This link has expired or has already been used. Request a new one.",
    over_request_rate_limit: "Please wait a moment before trying again.",
    over_email_send_rate_limit: "Please wait before requesting another email.",
    same_password: "Choose a password different from your current password.",
    weak_password: "Choose a stronger password with at least 12 characters.",
    mfa_verification_failed:
      "That code didn’t match. Use the latest six-digit code from your authenticator app.",
    mfa_challenge_expired:
      "That verification attempt expired. Enter the latest code and try again.",
    session_not_found: "Your session has expired. Please sign in again.",
    reauthentication_needed:
      "Please sign in again before changing your password.",
  };
  return messages[code] || fallback;
}
