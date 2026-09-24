import { useState, useEffect, useRef, type MouseEvent } from "react";
import {
  LayoutDashboard,
  Target,
  Users,
  Calendar,
  GitBranch,
  Wallet,
  BookOpen,
  Trophy,
  UserCircle,
  HelpCircle,
  Bell,
  ShieldCheck,
  Upload,
  Settings,
  FileText,
  Activity,
  Palette,
  Search,
  ChevronDown,
  ArrowUpRight,
  Pin,
  type LucideIcon,
} from "lucide-react";
import type { Row } from "../shared/core";
import { Modal, useApp } from "./lib";

export type WorkspacePage = {
  to: string;
  title: string;
  group: string;
  description: string;
  icon: LucideIcon;
};

export function workspacePages(ctx: Row): WorkspacePage[] {
  const pages: WorkspacePage[] = [],
    has = (role: string) =>
      ctx.roles.includes("owner") || ctx.roles.includes(role),
    add = (
      to: string,
      title: string,
      group: string,
      icon: LucideIcon,
      description: string,
    ) => pages.push({ to, title, group, icon, description });
  add(
    "/",
    "Home",
    "Workspace",
    LayoutDashboard,
    "Your overview and next steps",
  );
  if (ctx.rep) {
    if (ctx.rep.status === "active") {
      add(
        "/focus",
        "Call workspace",
        "My sales",
        Target,
        "Focus session, scripts and call outcomes",
      );
      add(
        "/leads",
        "My leads",
        "My sales",
        Users,
        "Assigned businesses, search and notes",
      );
      add(
        "/followups",
        "Follow-ups",
        "My sales",
        Calendar,
        "Upcoming and overdue callbacks",
      );
      add(
        "/pipeline",
        "My pipeline",
        "My sales",
        GitBranch,
        "Opportunities, deals and customer checkout",
      );
    } else
      add(
        "/onboarding",
        "Get started",
        "My sales",
        ShieldCheck,
        "Finish your onboarding and activation checklist",
      );
    add(
      "/money",
      "My money",
      "My sales",
      Wallet,
      "Commissions, payout setup and payment history",
    );
  }
  if (has("sales_admin")) {
    if (ctx.rep)
      add(
        "/admin",
        "Business overview",
        "Sales",
        LayoutDashboard,
        "Administrative totals and team next steps",
      );
    add(
      "/admin/leads",
      "Businesses",
      "Sales",
      Users,
      "Prospect database, assignments and lead ownership",
    );
    add(
      "/admin/imports",
      "Import leads",
      "Sales",
      Upload,
      "Upload spreadsheets, map columns and review duplicates",
    );
    add(
      "/admin/pipeline",
      "Deals & quotes",
      "Sales",
      GitBranch,
      "Pipeline, Advanced quotes and checkout links",
    );
    add(
      "/admin/fulfillment",
      "Fulfillment",
      "Sales",
      GitBranch,
      "Paid customer handoffs and delivery status",
    );
    add(
      "/admin/recruiting",
      "Recruiting",
      "People",
      Users,
      "Review applications and invite approved reps",
    );
    add(
      "/admin/reps",
      "Reps",
      "People",
      UserCircle,
      "Rep accounts, onboarding readiness and activation",
    );
  }
  if (has("manager"))
    add(
      "/team",
      "My team",
      "People",
      Users,
      "Your assigned reps and businesses",
    );
  if (has("finance_admin"))
    add(
      "/admin/finance",
      "Finance",
      "Operations",
      Wallet,
      "Packages, commission rules, holds, transfers and payouts",
    );
  if (has("compliance_admin"))
    add(
      "/admin/compliance",
      "Compliance",
      "Operations",
      ShieldCheck,
      "Do-not-call suppression and compliance records",
    );
  if (has("support"))
    add(
      "/admin/support",
      "Support inbox",
      "Operations",
      HelpCircle,
      "Answer rep support requests",
    );
  if (has("content_admin"))
    add(
      "/admin/content",
      "Training & content",
      "Resources",
      BookOpen,
      "Publish lessons, quizzes, scripts and agreements",
    );
  add(
    "/academy",
    "Academy",
    "Resources",
    BookOpen,
    "Read training and complete quizzes",
  );
  add(
    "/leaderboard",
    "Leaderboard",
    "Resources",
    Trophy,
    "Team sales and activity rankings",
  );
  add(
    "/appearance",
    "Appearance",
    "Settings & account",
    Palette,
    "Customize theme, accent, text, layout and pinned pages",
  );
  if (has("owner")) {
    add(
      "/admin/settings",
      "Workspace settings",
      "Settings & account",
      Settings,
      "Recruiting page, calling policy, XP and activation requirements",
    );
    add(
      "/admin/health",
      "System health",
      "Settings & account",
      Activity,
      "Integration configuration and background jobs",
    );
    add(
      "/admin/audit",
      "Audit log",
      "Settings & account",
      FileText,
      "Recorded administrative changes and reasons",
    );
  }
  add(
    "/notifications",
    "Notifications",
    "Settings & account",
    Bell,
    "Updates and reminders",
  );
  add(
    "/profile",
    "My account",
    "Settings & account",
    UserCircle,
    "Profile, personal goals and password",
  );
  if (ctx.rep)
    add(
      "/support",
      "Help & support",
      "Settings & account",
      HelpCircle,
      "Ask about your account, leads or payments",
    );
  return pages;
}

export function navigateClick(
  event: MouseEvent<HTMLAnchorElement>,
  to: string,
  navigate: (to: string) => void,
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(to);
}

export function WorkspaceNavigation({
  pages,
  current,
}: {
  pages: WorkspacePage[];
  current: string;
}) {
  const app = useApp();
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navigationRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);
  const pinned = app.preferences.pinned
    .map((to: string) => pages.find((p) => p.to === to))
    .filter(Boolean) as WorkspacePage[];
  const links = (items: WorkspacePage[]) =>
    items.map(({ to, title, icon: Icon }) => (
      <a
        key={to}
        href={to}
        className={"nav-item " + (current === to ? "active" : "")}
        aria-current={current === to ? "page" : undefined}
        onClick={(e) => navigateClick(e, to, app.navigate)}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{title}</span>
      </a>
    ));
  return (
    <nav
      ref={navigationRef}
      className="workspace-navigation"
      aria-label="Main navigation"
    >
      {links(pages.filter((p) => p.group === "Workspace"))}
      {!!pinned.length && (
        <div className="pinned-navigation">
          <div className="nav-label">
            <Pin size={12} /> PINNED
          </div>
          {links(pinned)}
        </div>
      )}
      {[...new Set(pages.map((p) => p.group))]
        .filter((g) => g !== "Workspace")
        .map((group) => {
          const items = pages.filter((p) => p.group === group);
          return (
            <details
              className="nav-group"
              key={group}
              open={
                items.some((p) => p.to === current) ||
                (current === "/" &&
                  ["My sales", "Sales", "People"].includes(group))
              }
            >
              <summary className="nav-label">
                {group}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              {links(items)}
            </details>
          );
        })}
    </nav>
  );
}

export function PageFinder({
  pages,
  onClose,
}: {
  pages: WorkspacePage[];
  onClose: () => void;
}) {
  const app = useApp(),
    [query, setQuery] = useState("");
  const terms = query.toLowerCase().trim().split(/\s+/),
    matches = pages.filter((p) =>
      terms.every((t) =>
        (p.title + " " + p.description + " " + p.group)
          .toLowerCase()
          .includes(t),
      ),
    );
  return (
    <Modal title="Find a page" onClose={onClose}>
      <label className="page-search field">
        <span>Where would you like to go?</span>
        <div>
          <Search size={18} aria-hidden="true" />
          <input
            data-autofocus
            type="search"
            value={query}
            placeholder="Try leads, commissions, appearance…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length) {
                e.preventDefault();
                onClose();
                app.navigate(matches[0].to);
              }
            }}
          />
        </div>
      </label>
      <p className="muted" role="status">
        {matches.length} {matches.length === 1 ? "page" : "pages"} available to
        your account
      </p>
      <ul className="page-results">
        {matches.map(({ to, title, description, icon: Icon }) => (
          <li key={to}>
            <a
              href={to}
              onClick={(e) =>
                navigateClick(e, to, (next) => {
                  onClose();
                  app.navigate(next);
                })
              }
            >
              <Icon size={19} aria-hidden="true" />
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {!matches.length && (
        <div className="state">
          No matching pages. Try “leads”, “settings” or “training”.
        </div>
      )}
    </Modal>
  );
}
