import { useEffect, useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { api, Form, type Field, State } from "./lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthShell } from "./auth-shell";
import { authErrorMessage } from "../shared/auth";
export function SignIn({
  client,
  configured,
  appUrl,
  recruitingUrl,
  notice = "",
}: {
  client: SupabaseClient | null;
  configured: boolean;
  appUrl: string;
  recruitingUrl: string;
  notice?: string;
}) {
  const [reset, setReset] = useState(
      new URLSearchParams(location.search).has("reset"),
    ),
    [sent, setSent] = useState(false);
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="brand">
          P<span>PIXELALTY</span>
        </div>
        <div>
          <span className="eyebrow">THE SALES WORKSPACE</span>
          <h1>
            Good conversations.
            <br />
            Meaningful growth.
          </h1>
          <p>
            Your leads, next steps, and progress.
            <br />
            One focused place to do your best work.
          </p>
        </div>
        <div className="muted">PIXELALTY SALES · RECRUITING & CRM</div>
      </div>
      <div className="auth-form">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>{reset ? "Reset your password" : "Sign in to your workspace"}</h2>
        <p>Use the email associated with your Pixelalty invitation.</p>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!configured ? (
          <div className="notice">
            This workspace is awaiting configuration. An administrator needs to
            finish setup before sign-in is available.
          </div>
        ) : sent ? (
          <div className="notice">Check your email for the next step.</div>
        ) : (
          <Form
            fields={[
              { name: "email", label: "Email", type: "email", required: true },
              ...(reset
                ? []
                : [
                    {
                      name: "password",
                      label: "Password",
                      type: "password",
                      required: true,
                    },
                  ]),
            ]}
            submit={reset ? "Send reset email" : "Sign in"}
            onSubmit={async (p) => {
              const r = reset
                ? await client!.auth.resetPasswordForEmail(p.email, {
                    redirectTo: appUrl + "/recover",
                  })
                : await client!.auth.signInWithPassword({
                    email: p.email,
                    password: p.password,
                  });
              if (r.error) throw Error(authErrorMessage(r.error));
              if (reset) setSent(true);
            }}
          />
        )}
        <button
          className="text-button"
          onClick={() => {
            setReset(!reset);
            setSent(false);
          }}
        >
          {reset ? "Back to sign in" : "Forgot your password?"}
        </button>
        <div className="divider" />
        <p>Interested in joining Pixelalty?</p>
        <a className="button" href={recruitingUrl}>
          Explore the opportunity <ArrowRight size={16} />
        </a>
      </div>
    </div>
  );
}
export function MFA({
  client,
  onSuccess,
}: {
  client: SupabaseClient;
  onSuccess: () => void;
}) {
  const [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    client.auth.mfa
      .listFactors()
      .then(async (r) => {
        if (!live) return;
        if (r.error) {
          setError(authErrorMessage(r.error));
          return;
        }
        const existing = r.data?.totp.find((x) => x.status === "verified");
        if (existing) setFactor(existing.id);
        else {
          for (const f of r.data?.all || [])
            if (f.factor_type === "totp" && f.status === "unverified") {
              const removed = await client.auth.mfa.unenroll({
                factorId: f.id,
              });
              if (removed.error) throw removed.error;
            }
          if (!live) return;
          const e = await client.auth.mfa.enroll({
            factorType: "totp",
            issuer: "Pixelalty Sales",
            friendlyName: "Pixelalty Sales",
          });
          if (!live) return;
          if (e.error) setError(authErrorMessage(e.error));
          else {
            setFactor(e.data.id);
            setQr(e.data.totp.qr_code);
          }
        }
      })
      .catch(
        () =>
          live &&
          setError(
            "We couldn’t load your verification method. Check your connection and try again.",
          ),
      );
    return () => {
      live = false;
    };
  }, [client, attempt]);
  return (
    <AuthShell>
      <ShieldCheck size={34} />
      <h1>Protect your admin access</h1>
      <p>Use your authenticator app to verify this session.</p>
      {qr && (
        <>
          <img className="qr" src={qr} alt="Authenticator enrollment QR code" />
          <p>Scan this code in your authenticator app.</p>
        </>
      )}
      <State error={error} />
      {error && !factor && (
        <button onClick={() => setAttempt((v) => v + 1)}>Try again</button>
      )}
      {!factor && !error && <State loading />}
      {factor && (
        <Form
          fields={[
            {
              name: "code",
              label: "Six-digit authentication code",
              required: true,
              inputMode: "numeric",
              autoComplete: "one-time-code",
              pattern: "[0-9]{6}",
              minLength: 6,
              maxLength: 6,
            },
          ]}
          submit="Verify session"
          onSubmit={async (p) => {
            const r = await client.auth.mfa.challengeAndVerify({
              factorId: factor,
              code: p.code,
            });
            if (r.error) throw Error(authErrorMessage(r.error));
            onSuccess();
          }}
        />
      )}
      <button className="text-button" onClick={() => client.auth.signOut()}>
        Sign out
      </button>
    </AuthShell>
  );
}
export function PasswordSetup({
  client,
  onComplete,
  invite = false,
}: {
  client: SupabaseClient;
  onComplete: () => void;
  invite?: boolean;
}) {
  return (
    <AuthShell>
      <ShieldCheck size={36} />
      <h1>{invite ? "Welcome to Pixelalty" : "Choose a new password"}</h1>
      <p>
        Use at least 12 characters. A unique password helps keep your workspace
        secure.
      </p>
      <Form
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            required: true,
            minLength: 12,
            autoComplete: "new-password",
          },
          {
            name: "confirmation",
            label: "Confirm new password",
            type: "password",
            required: true,
            minLength: 12,
            autoComplete: "new-password",
          },
        ]}
        submit="Save password and continue"
        onSubmit={async (p) => {
          if (p.password !== p.confirmation)
            throw Error("The passwords do not match.");
          const r = await client.auth.updateUser({ password: p.password });
          if (r.error) throw Error(authErrorMessage(r.error));
          onComplete();
        }}
      />
    </AuthShell>
  );
}
export function Apply({
  siteKey,
  appUrl,
}: {
  siteKey: string;
  appUrl: string;
}) {
  const [done, setDone] = useState(false),
    [copy, setCopy] = useState({
      title: "Your next good conversation starts here.",
      body: "Help businesses take a confident next step online.",
      requirements: "",
    }),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [token, setToken] = useState("");
  useEffect(() => {
    api("/recruiting")
      .then((r) => {
        setOpen(r.recruiting_open);
        setCopy({ title: r.title, body: r.body, requirements: r.requirements });
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!siteKey || !open || done) return;
    let widget: any;
    const render = () => {
      widget = (window as any).turnstile?.render("#turnstile", {
        sitekey: siteKey,
        action: "apply",
        callback: setToken,
        "expired-callback": () => setToken(""),
      });
    };
    const existing = document.querySelector("#turnstile-script");
    if (existing) render();
    else {
      const s = document.createElement("script");
      s.id = "turnstile-script";
      s.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      if (widget !== undefined) (window as any).turnstile?.remove(widget);
    };
  }, [siteKey, open, done]);
  const fields: Field[] = [
    { name: "name", label: "Full name", required: true },
    { name: "preferred_name", label: "Preferred name (optional)" },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone with country code", required: true },
    { name: "state", label: "State / province", required: true },
    { name: "country", label: "Country", required: true },
    {
      name: "timezone",
      label: "Timezone",
      required: true,
      hint: "For example, America/New_York.",
    },
    {
      name: "experience",
      label: "Sales, cold-calling, or customer-service experience",
      type: "textarea",
    },
    {
      name: "availability",
      label: "Hours available per week",
      type: "number",
      min: 1,
      max: 80,
      required: true,
    },
    {
      name: "cold_calling_experience",
      label: "Cold-calling experience",
      type: "textarea",
    },
    {
      name: "customer_service_experience",
      label: "Customer-service experience",
      type: "textarea",
    },
    {
      name: "motivation",
      label: "Why would you like to join Pixelalty?",
      type: "textarea",
      required: true,
    },
    {
      name: "outbound_ready",
      label: "I am comfortable making outbound business calls.",
      type: "checkbox",
    },
    { name: "computer", label: "I have a computer.", type: "checkbox" },
    { name: "internet", label: "I have stable internet.", type: "checkbox" },
    { name: "headset", label: "I have a headset or phone.", type: "checkbox" },
    {
      name: "age_confirmed",
      label: "I confirm that I am at least 18 years old.",
      type: "checkbox",
      required: true,
    },
    {
      name: "compensation_ack",
      label:
        "I understand commissions are conditional and earnings are not guaranteed.",
      type: "checkbox",
      required: true,
    },
  ];
  return (
    <div className="apply-page">
      <nav>
        <a className="brand" href="https://pixelalty.com">
          P<span>PIXELALTY</span>
        </a>
        <a href={appUrl + "/"}>
          Rep sign in <ArrowRight size={16} />
        </a>
      </nav>
      <section className="apply-hero">
        <div className="eyebrow">BUILD YOUR SALES CAREER</div>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <a className="button primary" href="#application">
          Apply to join <ArrowRight size={18} />
        </a>
      </section>
      <section
        className="recruiting-benefits"
        aria-label="Working with Pixelalty"
      >
        {[
          [
            "Remote & flexible",
            "Build your sales experience around focused, responsible prospecting.",
          ],
          [
            "Learn a clear process",
            "Structured onboarding, training and practical guidance help you get started.",
          ],
          [
            "Tools to do your best work",
            "Work assigned leads with a focused sales workspace and clear next steps.",
          ],
          [
            "See your progress",
            "Track eligible commissions privately and progress through verified performance.",
          ],
        ].map(([title, body]) => (
          <article key={title}>
            <Check size={22} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
      <p className="fine-print">
        Performance-based compensation. Earnings are not guaranteed.
      </p>
      <section id="application" className="application-section">
        <div>
          <div className="eyebrow">A CLEAR START</div>
          <h2>Tell us about yourself.</h2>
          <p>We review each application before sending an invitation.</p>
          <p>{copy.requirements}</p>
          {[
            "Apply and meet the team",
            "Complete onboarding and training",
            "Work your assigned business leads",
          ].map((x) => (
            <p key={x}>
              <Check size={18} />
              {x}
            </p>
          ))}
        </div>
        <CardBox>
          {done ? (
            <>
              <Check size={38} />
              <h2>Application received</h2>
              <p>
                Thank you for your interest. We’ll review your application and
                contact you about next steps.
              </p>
            </>
          ) : error ? (
            <State error={error} />
          ) : !open || !siteKey ? (
            <div className="notice">
              Applications are not open yet. Please check back later.
            </div>
          ) : (
            <Form
              fields={fields}
              initial={{
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }}
              submit="Submit application"
              onSubmit={async (p) => {
                if (!token) throw Error("Complete the verification first.");
                try {
                  await api("/apply", { ...p, token });
                  setDone(true);
                } finally {
                  setToken("");
                  (window as any).turnstile?.reset();
                }
              }}
            >
              <div id="turnstile" />
            </Form>
          )}
        </CardBox>
      </section>
      <footer>
        © Pixelalty · <a href="https://pixelalty.com/privacy.html">Privacy</a>
      </footer>
    </div>
  );
}
function CardBox({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}
