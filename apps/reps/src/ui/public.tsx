import { useEffect, useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { api, Form, type Field, State } from "./lib";
import { PACKAGES, money } from "../shared/core";
import type { SupabaseClient } from "@supabase/supabase-js";
export function SignIn({
  client,
  configured,
}: {
  client: SupabaseClient | null;
  configured: boolean;
}) {
  const [reset, setReset] = useState(false),
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
                    redirectTo: location.origin + "/profile?reset=1",
                  })
                : await client!.auth.signInWithPassword({
                    email: p.email,
                    password: p.password,
                  });
              if (r.error) throw r.error;
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
        <a className="button" href="/apply">
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
    [error, setError] = useState("");
  useEffect(() => {
    client.auth.mfa.listFactors().then(async (r) => {
      const existing = r.data?.totp.find((x) => x.status === "verified");
      if (existing) setFactor(existing.id);
      else {
        const e = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Pixelalty Sales",
        });
        if (e.error) setError(e.error.message);
        else {
          setFactor(e.data.id);
          setQr(e.data.totp.qr_code);
        }
      }
    });
  }, []);
  return (
    <div className="center-card">
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
      <Form
        fields={[
          {
            name: "code",
            label: "Six-digit authentication code",
            required: true,
          },
        ]}
        submit="Verify session"
        onSubmit={async (p) => {
          const r = await client.auth.mfa.challengeAndVerify({
            factorId: factor,
            code: p.code,
          });
          if (r.error) throw r.error;
          onSuccess();
        }}
      />
    </div>
  );
}
export function Apply({ siteKey }: { siteKey: string }) {
  const [done, setDone] = useState(false),
    [packages, setPackages] = useState<any[]>(
      [...PACKAGES].map((p) => ({
        ...p,
        price_cents: p.price,
        commission_cents: p.commission,
      })),
    ),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [token, setToken] = useState("");
  useEffect(() => {
    api("/recruiting")
      .then((r) => {
        setPackages(r.packages);
        setOpen(r.recruiting_open);
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
        <a href="/">
          Rep sign in <ArrowRight size={16} />
        </a>
      </nav>
      <section className="apply-hero">
        <div className="eyebrow">BUILD YOUR SALES CAREER</div>
        <h1>
          Your next good
          <br />
          conversation starts here.
        </h1>
        <p>
          Help businesses take a confident next step online.
          <br />
          Join Pixelalty’s sales team with clear training, focused tools, and
          transparent commission tracking.
        </p>
        <a className="button primary" href="#application">
          Apply to join <ArrowRight size={18} />
        </a>
      </section>
      <section className="package-grid">
        {packages.map((p) => (
          <article key={p.code}>
            <span className="eyebrow">{p.name}</span>
            <h2>{money(p.commission_cents)}</h2>
            <p>Standard commission</p>
            <small>
              {money(p.price_cents)}
              {p.code === "advanced" ? "+" : ""} customer package
            </small>
          </article>
        ))}
      </section>
      <p className="fine-print">
        Commissions depend on verified payment, applicable agreements, holds,
        refunds, and eligibility. Advanced commission does not automatically
        increase with project price.
      </p>
      <section id="application" className="application-section">
        <div>
          <div className="eyebrow">A CLEAR START</div>
          <h2>Tell us about yourself.</h2>
          <p>We review each application before sending an invitation.</p>
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
                await api("/apply", { ...p, token });
                setDone(true);
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
