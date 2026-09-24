export const emailSupportUrl = "https://pixelalty.com/contact.html";
type EmailCopy = {
  subject: string;
  title: string;
  intro: string;
  detail: string;
  action?: string;
  url?: string;
  code?: string;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function brandedEmail(copy: EmailCopy) {
  const subject = copy.subject;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(subject)}</title>
<style>@media(prefers-color-scheme:dark){.email-bg{background:#101620!important}.email-card{background:#182130!important;color:#edf2fa!important}.email-muted{color:#aab8ce!important}.email-title{color:#edf2fa!important}.email-link{color:#a6c6ff!important}.email-card{border-color:#304159!important}}@media(max-width:600px){.email-content{padding:28px 22px!important}}</style></head>
<body class="email-bg" style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#141c2b"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(copy.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:separate">
<tr><td style="background:#111c2e;padding:28px 32px;border-radius:14px 14px 0 0;color:#fff"><div style="font-size:23px;font-weight:800;letter-spacing:3px">PIXELALTY</div><div style="font-size:10px;letter-spacing:3px;color:#b3c8ed;margin-top:8px">PIXELALTY SALES</div></td></tr>
<tr><td class="email-card email-content" style="background:#fff;padding:38px 32px;border-radius:0 0 14px 14px;border:1px solid #dfe5ef;border-top:0">
<h1 class="email-title" style="font-size:27px;line-height:1.3;margin:0 0 22px;color:#141c2b">${escape(copy.title)}</h1>
<p class="email-muted" style="font-size:15px;line-height:1.7;color:#536276;margin:0 0 18px">${escape(copy.intro)}</p>
${copy.code ? `<p class="email-title" style="font-size:30px;letter-spacing:8px;font-weight:bold;margin:28px 0">${escape(copy.code)}</p>` : ""}
${copy.url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td bgcolor="#245dcc" style="border-radius:8px"><a href="${escape(copy.url)}" style="display:inline-block;color:#fff;background:#245dcc;border:16px solid #245dcc;border-radius:8px;font-size:12px;line-height:1.6;font-weight:bold;letter-spacing:.5px;text-decoration:none">${escape(copy.action || "OPEN PIXELALTY SALES")}</a></td></tr></table>` : ""}
<p class="email-muted" style="font-size:14px;line-height:1.7;color:#536276;margin:0 0 24px">${escape(copy.detail)}</p>
<p class="email-muted" style="border-top:1px solid #dfe5ef;padding-top:22px;font-size:12px;line-height:1.7;color:#657184;margin:0">Need help? <a class="email-link" href="${emailSupportUrl}" style="color:#245dcc">Contact Pixelalty</a>. Never share your password or authentication code. If you weren’t expecting this email, contact us before continuing.</p>
</td></tr><tr><td align="center" class="email-muted" style="padding:22px;font-size:11px;line-height:1.7;color:#657184">Pixelalty Sales · Your sales workspace<br><a class="email-link" href="https://pixelalty.com" style="color:#657184;text-decoration:none">pixelalty.com</a></td></tr></table></td></tr></table></body></html>`;
  return {
    subject,
    html,
    text: [
      "PIXELALTY — PIXELALTY SALES",
      copy.title,
      copy.intro,
      copy.code,
      copy.action,
      copy.url,
      copy.detail,
      "Need help? " + emailSupportUrl,
      "Never share your password or authentication code.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
export const authEmailTypes = [
  "invite",
  "recovery",
  "confirmation",
  "magic_link",
  "email_change",
  "reauthentication",
  "password_changed_notification",
  "email_changed_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
] as const;
export type AuthEmailType = (typeof authEmailTypes)[number];
export function authEmail(
  type: AuthEmailType,
  appUrl = "https://reps.pixelalty.com",
) {
  const origin = new URL(appUrl).origin;
  if (!origin.startsWith("https://"))
    throw Error("Hosted email links require HTTPS.");
  const flow = (
    {
      invite: "invite",
      recovery: "recovery",
      confirmation: "email",
      magic_link: "magiclink",
      email_change: "email_change",
    } as Record<string, string>
  )[type];
  const copies: Record<AuthEmailType, EmailCopy> = {
    invite: {
      subject: "You’re invited to Pixelalty Sales",
      title: "Welcome to Pixelalty Sales",
      intro:
        "You’re receiving this invitation because Pixelalty has approved your application or invited you to join our sales team.",
      action: "SET UP YOUR PIXELALTY ACCOUNT",
      detail:
        "Create your password, then complete your profile, agreement and training. Your administrator will review your onboarding before activating your access to leads. This personal invitation can be used once.",
    },
    recovery: {
      subject: "Set up or reset your Pixelalty password",
      title: "Your next step starts here",
      intro:
        "A secure password setup or reset was requested for your Pixelalty Sales account.",
      action: "CHOOSE YOUR PASSWORD",
      detail:
        "Choose a strong, unique password to return to your workspace or continue onboarding. If you didn’t request this, your current password stays unchanged and you can ignore this email.",
    },
    confirmation: {
      subject: "Confirm your Pixelalty email",
      title: "Confirm your email address",
      intro:
        "Confirm this email address to finish setting up your Pixelalty Sales account.",
      action: "CONFIRM MY EMAIL",
      detail:
        "After confirmation, sign in to complete the remaining steps in your onboarding checklist. This link is personal and can be used once.",
    },
    magic_link: {
      subject: "Your secure Pixelalty sign-in link",
      title: "Sign in to Pixelalty Sales",
      intro:
        "Use your one-time link to securely open your Pixelalty Sales workspace.",
      action: "SIGN IN TO PIXELALTY",
      detail:
        "If you didn’t request this sign-in link, you can ignore this email. Do not forward your link to anyone.",
    },
    email_change: {
      subject: "Confirm your Pixelalty email change",
      title: "Confirm your email change",
      intro: "A change to your Pixelalty Sales sign-in email was requested.",
      action: "CONFIRM EMAIL CHANGE",
      detail:
        "You may need to confirm using both your current and new inboxes. If you didn’t request this change, contact Pixelalty immediately.",
    },
    reauthentication: {
      subject: "Your Pixelalty verification code",
      title: "Verify it’s you",
      intro:
        "Use this one-time code to confirm the sensitive change you requested in Pixelalty Sales.",
      code: "{{ .Token }}",
      detail:
        "Enter the code only in your Pixelalty workspace. Pixelalty will never ask you to send this code to another person.",
    },
    password_changed_notification: {
      subject: "Your Pixelalty password was changed",
      title: "Your password is updated",
      intro: "The password for your Pixelalty Sales account was just changed.",
      detail:
        "If this was you, no action is needed. If you didn’t make this change, reset your password and contact Pixelalty immediately.",
      action: "OPEN PIXELALTY SALES",
      url: origin,
    },
    email_changed_notification: {
      subject: "Your Pixelalty sign-in email was changed",
      title: "Your sign-in email is updated",
      intro: "The email address for your Pixelalty Sales account was changed.",
      detail:
        "If you didn’t make this change, contact Pixelalty immediately. This message does not contain your account credentials.",
      url: origin,
    },
    mfa_factor_enrolled_notification: {
      subject: "Pixelalty sign-in protection updated",
      title: "A verification method was added",
      intro:
        "A new sign-in verification method was added to your Pixelalty Sales account.",
      detail:
        "If you didn’t add this method, contact Pixelalty immediately to protect your account.",
      url: origin,
    },
    mfa_factor_unenrolled_notification: {
      subject: "Pixelalty sign-in protection changed",
      title: "A verification method was removed",
      intro:
        "A sign-in verification method was removed from your Pixelalty Sales account.",
      detail:
        "If you didn’t remove this method, contact Pixelalty immediately to protect your account.",
      url: origin,
    },
  };
  return brandedEmail({
    ...copies[type],
    ...(flow
      ? {
          url:
            origin + "/auth/confirm#token_hash={{ .TokenHash }}&type=" + flow,
        }
      : {}),
  });
}
export function onboardingEmail(
  type: "activated" | "onboarding",
  appUrl: string,
) {
  const origin = new URL(appUrl).origin;
  return brandedEmail(
    type === "activated"
      ? {
          subject: "Your Pixelalty Sales account is active",
          title: "Your workspace is ready",
          intro:
            "Your onboarding has been approved and your Pixelalty Sales account is now active.",
          detail:
            "Sign in to review your training, claim available leads and plan your next conversations. Your workspace keeps your progress, follow-ups and commission status together.",
          action: "OPEN YOUR WORKSPACE",
          url: origin + "/leads",
        }
      : {
          subject: "Your next steps with Pixelalty Sales",
          title: "Continue your onboarding",
          intro:
            "Your Pixelalty Sales onboarding checklist is ready when you are.",
          detail:
            "Complete your profile, review your agreement and finish your assigned training. Your administrator will review the required steps before activating sales access.",
          action: "CONTINUE ONBOARDING",
          url: origin + "/onboarding",
        },
  );
}
