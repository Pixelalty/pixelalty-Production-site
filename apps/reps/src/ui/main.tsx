import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  Bell,
  Menu,
  LogOut,
  ShieldCheck,
  X,
  Palette,
  Search,
  Pin,
  ArrowRight,
} from "lucide-react";
import {
  api,
  setClient,
  AppContext,
  State,
  Listing,
  Modal,
  Heading,
} from "./lib";
import { SignIn, Apply, MFA, PasswordSetup } from "./public";
import {
  Dashboard,
  Leads,
  Focus,
  Followups,
  Pipeline,
  Money,
  Academy,
  Onboarding,
  Profile,
  Leaderboard,
  Support,
} from "./pages";
const Admin = lazy(() => import("./admin").then((m) => ({ default: m.Admin })));
import type { Row } from "../shared/core";
import {
  workspacePreferences,
  type WorkspacePreferences,
} from "../shared/workspace";
import { workspacePages, WorkspaceNavigation, PageFinder } from "./navigation";
import { Appearance } from "./appearance";
import "./styles.css";
import "./workspace.css";
function storedTheme() {
  try {
    return localStorage.getItem("pixelalty-theme") || "system";
  } catch {
    return "system";
  }
}
function App() {
  const [config, setConfig] = useState<Row | null>(null),
    [client, setAuth] = useState<SupabaseClient | null>(null),
    [session, setSession] = useState<any>(null),
    [ctx, setCtx] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [path, setPath] = useState(location.pathname + location.search),
    [toast, setToast] = useState(""),
    [link, setLink] = useState(""),
    [menu, setMenu] = useState(false),
    [finder, setFinder] = useState(false),
    [mobile, setMobile] = useState(
      window.matchMedia("(max-width: 900px)").matches,
    ),
    [legacyTheme] = useState(storedTheme),
    [previewPreferences, setPreviewPreferences] =
      useState<WorkspacePreferences | null>(null),
    [savingPreferences, setSavingPreferences] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const preferences = useMemo(
    () =>
      workspacePreferences({
        theme: legacyTheme,
        density: ctx?.rep?.preferences?.compact ? "compact" : "comfortable",
        reduced_motion: !!ctx?.rep?.preferences?.reduced_motion,
        ...session?.user?.user_metadata?.pixelalty_workspace,
      }),
    [session?.user?.user_metadata, ctx?.rep?.preferences, legacyTheme],
  );
  const displayPreferences = previewPreferences || preferences;
  const theme = displayPreferences.theme;
  useEffect(() => {
    document
      .getElementById("workspace-content")
      ?.focus({ preventScroll: true });
  }, [path]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 6000);
  };
  const navigate = (s: string) => {
    setPreviewPreferences(null);
    history.pushState({}, "", s);
    setPath(s);
    setMenu(false);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const authFlow = new URLSearchParams(location.hash.replace(/^#/, "")).get(
      "type",
    );
    let handledAuthFlow = false;
    let subscription: { unsubscribe: () => void } | undefined;
    let mounted = true;
    const fn = () => {
      setPath(location.pathname + location.search);
      setMenu(false);
      setPreviewPreferences(null);
    };
    window.addEventListener("popstate", fn);
    api("/config")
      .then((c) => {
        setConfig(c);
        if (c.configured) {
          const s = createClient(c.supabaseUrl, c.publishableKey, {
            auth: {
              storage: sessionStorage,
              persistSession: true,
              detectSessionInUrl: true,
            },
          });
          setClient(s);
          setAuth(s);
          s.auth.getSession().then((r) => setSession(r.data.session));
          const { data } = s.auth.onAuthStateChange((_event, newSession) => {
            if (mounted) {
              setSession(newSession);
              if (newSession && !handledAuthFlow) {
                if (_event === "PASSWORD_RECOVERY" || authFlow === "recovery") {
                  handledAuthFlow = true;
                  navigate("/recover");
                } else if (authFlow === "invite") {
                  handledAuthFlow = true;
                  navigate("/welcome");
                }
              }
            }
          });
          subscription = data.subscription;
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      mounted = false;
      subscription?.unsubscribe();
      window.removeEventListener("popstate", fn);
    };
  }, []);
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.compact = String(displayPreferences.density === "compact");
    d.motion = displayPreferences.reduced_motion ? "reduced" : "auto";
    d.accent = displayPreferences.accent;
    d.textSize = displayPreferences.text_size;
    d.sidebar = displayPreferences.sidebar;
  }, [displayPreferences]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const change = () => {
      setMobile(media.matches);
      if (!media.matches) setMenu(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLElement>(".close-menu")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(false);
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          sidebarRef.current?.querySelectorAll<HTMLElement>(
            "a[href],button,summary",
          ) || [],
        ).filter(
          (el) => el.getClientRects().length && !el.hasAttribute("disabled"),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [menu]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (ctx && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu(false);
        setFinder((value) => !value);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ctx]);
  const reloadContext = useCallback(() => {
    if (session)
      api("/me")
        .then((value) => {
          setCtx(value);
          setError("");
        })
        .catch((e) => setError(e.message));
  }, [session]);
  useEffect(() => {
    if (session) reloadContext();
  }, [version]);
  useEffect(() => {
    if (session) reloadContext();
    else setCtx(null);
  }, [session]);
  useEffect(() => {
    try {
      localStorage.setItem("pixelalty-theme", theme);
    } catch {
      /* The signed-in preference still saves to the account. */
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const mutate = async (action: string, p: Row = {}) => {
    const result = await api("/action", { action, p });
    refresh();
    return result;
  };
  const savePreferences = async (patch: Partial<WorkspacePreferences>) => {
    if (!client || !session) throw Error("Sign in to save your preferences.");
    if (savingPreferences) throw Error("Wait for the current save to finish.");
    setSavingPreferences(true);
    try {
      const next = workspacePreferences({ ...preferences, ...patch });
      const result = await client.auth.updateUser({
        data: { pixelalty_workspace: next },
      });
      if (result.error) throw result.error;
      if (!result.data.user)
        throw Error("Your preferences were not saved. Please try again.");
      setSession((current: any) =>
        current?.user?.id === result.data.user.id
          ? { ...current, user: result.data.user }
          : current,
      );
      return next;
    } finally {
      setSavingPreferences(false);
    }
  };
  const setTheme = (next: string) =>
    run(() =>
      savePreferences({ theme: workspacePreferences({ theme: next }).theme }),
    );
  if (error)
    return (
      <div className="center-card">
        <h1>Workspace unavailable</h1>
        <State error={error} />
        <button onClick={() => location.reload()}>Try again</button>
        {client && (
          <button
            onClick={async () => {
              await client.auth.signOut({ scope: "local" });
              setSession(null);
              setError("");
            }}
          >
            Return to sign in
          </button>
        )}
      </div>
    );
  if (!config) return <State loading />;
  if (path.startsWith("/apply"))
    return <Apply siteKey={config.turnstileSiteKey} />;
  if (path.startsWith("/payment-return"))
    return (
      <div className="center-card">
        <ShieldCheck size={40} />
        <h1>{path.includes("success") ? "Thank you." : "Checkout closed."}</h1>
        <p>
          {path.includes("success")
            ? "We’re verifying the payment with Stripe. Your Pixelalty contact can confirm the next steps once verification is complete."
            : "No payment is confirmed by this page. Contact your Pixelalty representative if you would like to continue."}
        </p>
        <a className="button" href="https://pixelalty.com">
          Return to Pixelalty
        </a>
      </div>
    );
  if (!session)
    return <SignIn client={client} configured={config.configured} />;
  if (
    path.startsWith("/recover") ||
    path.startsWith("/welcome") ||
    (path.startsWith("/profile") &&
      new URLSearchParams(location.search).has("reset"))
  )
    return (
      <PasswordSetup
        client={client!}
        invite={path.startsWith("/welcome")}
        onComplete={() =>
          navigate(path.startsWith("/welcome") ? "/onboarding" : "/")
        }
      />
    );
  if (!ctx) return <State loading />;
  if (ctx.roles.length && ctx.aal !== "aal2")
    return <MFA client={client!} onSuccess={reloadContext} />;
  if (!ctx.rep && !ctx.roles.length)
    return (
      <div className="center-card">
        <h1>Your account isn’t active here yet.</h1>
        <p>A Pixelalty administrator needs to approve your access.</p>
        <button onClick={() => client?.auth.signOut()}>Sign out</button>
      </div>
    );
  const has = (role: string) =>
      ctx.roles.includes("owner") || ctx.roles.includes(role),
    root = path.split("?")[0];
  const pages = workspacePages(ctx);
  const admin = pages.filter(
    (p) => p.to.startsWith("/admin") || p.to === "/team",
  );
  const allowed = new Set(pages.map((p) => p.to));
  if (has("sales_admin")) allowed.add("/admin");
  if (ctx.rep) allowed.add("/onboarding");
  let screen: React.ReactNode;
  if (!allowed.has(root))
    screen = (
      <div className="notice">This page is not available for your role.</div>
    );
  else if (root.startsWith("/admin")) screen = <Admin />;
  else if (root === "/team")
    screen = (
      <>
        <Heading
          title="My team"
          description="Only the reps and businesses in your assigned teams appear here."
        />
        <Listing
          name="reps"
          columns={[
            ["name", "Rep"],
            ["code", "Rep ID"],
            ["status", "Status"],
          ]}
        />
        <Listing
          name="businesses"
          columns={[
            ["name", "Business"],
            ["stage", "Stage"],
            ["owner_id", "Rep"],
          ]}
        />
      </>
    );
  else if (root === "/notifications")
    screen = (
      <>
        <Heading title="Notifications">
          <button
            onClick={() =>
              run(() => mutate("notification_read", { all: true }))
            }
          >
            Mark all read
          </button>
        </Heading>
        <Listing
          name="notifications"
          query="&own=true"
          columns={[
            ["title", "Update"],
            ["body", "Details"],
            ["created_at", "Time"],
          ]}
          actions={(r) => (
            <>
              <button
                onClick={() =>
                  run(async () => {
                    await mutate("notification_read", { id: r.id });
                    navigate(
                      r.link?.startsWith("/") && !r.link.startsWith("//")
                        ? r.link
                        : "/",
                    );
                  })
                }
              >
                Open update
              </button>
              {!r.read_at && (
                <button
                  onClick={() =>
                    run(() => mutate("notification_read", { id: r.id }))
                  }
                >
                  Mark read
                </button>
              )}
            </>
          )}
        />
      </>
    );
  else
    screen = (
      {
        "/":
          !ctx.rep && has("sales_admin") ? (
            <Admin />
          ) : ctx.rep ? (
            <Dashboard />
          ) : (
            <>
              <Heading
                title="Your workspace"
                description="Choose an area available to your role."
              />
              <div className="button-row">
                {admin.map(({ to, title }) => (
                  <button key={String(to)} onClick={() => navigate(String(to))}>
                    {String(title)}
                  </button>
                ))}
              </div>
            </>
          ),
        "/focus": <Focus />,
        "/leads": <Leads />,
        "/followups": <Followups />,
        "/pipeline": <Pipeline />,
        "/money": <Money />,
        "/academy": <Academy />,
        "/onboarding": <Onboarding />,
        "/profile": <Profile />,
        "/appearance": <Appearance />,
        "/leaderboard": <Leaderboard />,
        "/support": <Support />,
      } as Record<string, React.ReactNode>
    )[root];
  const currentPage =
    pages.find((p) => p.to === root) ||
    (root === "/admin" ? pages.find((p) => p.to === "/") : undefined);
  return (
    <AppContext.Provider
      value={{
        ctx,
        client,
        config,
        version,
        path,
        navigate,
        refresh,
        notify,
        run,
        mutate,
        has,
        setLink,
        theme,
        setTheme,
        reloadContext,
        preferences,
        previewPreferences: setPreviewPreferences,
        savePreferences,
        savingPreferences,
        pages,
      }}
    >
      <div className="app-shell">
        <a className="skip-link" href="#workspace-content">
          Skip to main content
        </a>
        {menu && (
          <button
            className="menu-backdrop"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <aside
          ref={sidebarRef}
          id="workspace-sidebar"
          className={"sidebar " + (menu ? "open" : "")}
          inert={mobile && !menu}
          aria-label="Workspace navigation"
          role={menu ? "dialog" : undefined}
          aria-modal={menu || undefined}
        >
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            P
            <span>
              PIXELALTY<small>SALES WORKSPACE</small>
            </span>
          </a>
          <button
            className="close-menu icon"
            aria-label="Close menu"
            onClick={() => setMenu(false)}
          >
            <X />
          </button>
          <button
            className="sidebar-search"
            onClick={() => {
              setMenu(false);
              setFinder(true);
            }}
          >
            <Search size={17} />
            <span>Find a page</span>
            <kbd>⌘ / Ctrl K</kbd>
          </button>
          <WorkspaceNavigation
            pages={pages}
            current={currentPage?.to || root}
          />
          <a
            className="sidebar-customize"
            href="/appearance"
            onClick={(e) => {
              e.preventDefault();
              navigate("/appearance");
            }}
          >
            <Palette size={17} /> Customize workspace
          </a>
          <div className="sidebar-footer">
            <div className="avatar">{(ctx.rep?.name || "Admin")[0]}</div>
            <div>
              <strong>{ctx.rep?.name || "Administrator"}</strong>
              <small>{ctx.rep?.code || "Pixelalty"}</small>
            </div>
            <button
              className="icon"
              aria-label="Sign out"
              onClick={() => client?.auth.signOut()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="main-shell" inert={menu}>
          <header className="topbar">
            <button
              className="mobile-menu icon"
              aria-label="Open menu"
              aria-expanded={menu}
              aria-controls="workspace-sidebar"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <div className="breadcrumb">
              <span>{currentPage?.group || "Workspace"}</span>
              <span aria-hidden="true">/</span>
              <strong>{currentPage?.title || "Home"}</strong>
            </div>
            <div className="top-actions">
              {config.mode === "test" && (
                <span className="test-label" title="Stripe sandbox environment">
                  Sandbox
                </span>
              )}
              <button
                className="icon top-search"
                aria-label="Find a page"
                onClick={() => setFinder(true)}
              >
                <Search size={19} />
              </button>
              {currentPage &&
                !["/", "/appearance"].includes(currentPage.to) && (
                  <button
                    className="icon page-pin"
                    aria-label={
                      (preferences.pinned.includes(currentPage.to)
                        ? "Unpin "
                        : "Pin ") + currentPage.title
                    }
                    aria-pressed={preferences.pinned.includes(currentPage.to)}
                    disabled={savingPreferences}
                    onClick={() =>
                      run(async () => {
                        const pinned = preferences.pinned.includes(
                          currentPage.to,
                        )
                          ? preferences.pinned.filter(
                              (p) => p !== currentPage.to,
                            )
                          : [...preferences.pinned, currentPage.to];
                        if (pinned.length > 6)
                          throw Error(
                            "You can pin six pages. Open Appearance to change your shortcuts.",
                          );
                        await savePreferences({ pinned });
                        notify(
                          preferences.pinned.includes(currentPage.to)
                            ? "Page unpinned."
                            : "Page pinned to your sidebar.",
                        );
                      })
                    }
                  >
                    <Pin size={18} />
                  </button>
                )}
              <button
                className="icon"
                aria-label="Customize appearance"
                onClick={() => navigate("/appearance")}
              >
                <Palette size={19} />
              </button>
              <button
                className="icon"
                aria-label="Notifications"
                onClick={() => navigate("/notifications")}
              >
                <Bell size={18} />
              </button>
              <span className="avatar small">{(ctx.rep?.name || "A")[0]}</span>
            </div>
          </header>
          <main key={root} id="workspace-content" tabIndex={-1}>
            <Suspense fallback={<State loading />}>{screen}</Suspense>
          </main>
          <footer className="app-footer">
            <span>PIXELALTY SALES</span>
            <span>Make the next conversation count.</span>
          </footer>
        </div>
        {finder && (
          <PageFinder pages={pages} onClose={() => setFinder(false)} />
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button
              className="icon"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {link && (
          <Modal title="Customer checkout" onClose={() => setLink("")}>
            <p>
              This link is attributed to the selected deal and its saved package
              version.
            </p>
            <label className="field">
              <span>Checkout link</span>
              <input readOnly value={link} />
            </label>
            <div className="actions">
              <button
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(link);
                    notify("Checkout link copied.");
                  })
                }
              >
                Copy link
              </button>
              <a
                className="button primary"
                href={link}
                target="_blank"
                rel="noreferrer"
              >
                Open checkout <ArrowRight size={16} />
              </a>
            </div>
          </Modal>
        )}
      </div>
    </AppContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
