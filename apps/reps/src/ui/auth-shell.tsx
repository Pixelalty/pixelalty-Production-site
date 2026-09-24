import type { ReactNode } from "react";
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-shell-inner">
        <a
          className="auth-wordmark"
          href="/"
          aria-label="Pixelalty Sales sign in"
        >
          PIXELALTY<span>SALES</span>
        </a>
        <section className="center-card auth-card">{children}</section>
        <a className="auth-help" href="https://pixelalty.com/contact.html">
          Need help? Contact Pixelalty
        </a>
      </div>
    </main>
  );
}
