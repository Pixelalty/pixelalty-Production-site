export const accentOptions = [
  { value: "pixelalty", label: "Pixelalty", color: "#245dcc" },
  { value: "blue", label: "Blue", color: "#245dcc" },
  { value: "emerald", label: "Emerald", color: "#087568" },
  { value: "red", label: "Red", color: "#b12c43" },
  { value: "slate", label: "Slate", color: "#526580" },
  { value: "monochrome", label: "Monochrome", color: "#3e4756" },
  { value: "violet", label: "Violet", color: "#7043c1" },
  { value: "teal", label: "Teal", color: "#087568" },
  { value: "rose", label: "Rose", color: "#b33663" },
  { value: "amber", label: "Amber", color: "#986016" },
] as const;

export type WorkspacePreferences = {
  theme: "system" | "light" | "dark";
  accent: (typeof accentOptions)[number]["value"];
  density: "comfortable" | "compact" | "spacious";
  text_size: "standard" | "large";
  sidebar: "contrast" | "matching";
  reduced_motion: boolean;
  pinned: string[];
  sidebar_mode: "expanded" | "compact" | "collapsed" | "wide";
  cards: "minimal" | "standard" | "rounded";
  motion: "normal" | "reduced" | "off" | "premium";
  navigation_mode: "multiple" | "single";
  navigation_open: string[] | null;
  content_width: "balanced" | "wide" | "focused";
  font: "sans" | "humanist" | "system";
  heading_scale: "standard" | "compact" | "expressive";
  card_surface: "solid" | "flat" | "glass";
  border_strength: "subtle" | "defined";
  shadow: "none" | "soft" | "lifted";
  background: "solid" | "wash" | "dots" | "grid";
  buttons: "standard" | "soft" | "pill";
  icon_size: "standard" | "large";
  avatar: "initial" | "monogram" | "outline";
  frame: "simple" | "line" | "double";
  banner: "plain" | "wash" | "grid";
  achievements: string[];
  widgets: string[];
  hidden_widgets: string[];
};

export const defaultWorkspacePreferences: WorkspacePreferences = {
  theme: "system",
  accent: "blue",
  density: "comfortable",
  text_size: "standard",
  sidebar: "contrast",
  reduced_motion: false,
  pinned: [],
  sidebar_mode: "expanded",
  cards: "standard",
  motion: "normal",
  navigation_mode: "multiple",
  navigation_open: null,
  content_width: "balanced",
  font: "sans",
  heading_scale: "standard",
  card_surface: "solid",
  border_strength: "subtle",
  shadow: "soft",
  background: "solid",
  buttons: "standard",
  icon_size: "standard",
  avatar: "initial",
  frame: "simple",
  banner: "plain",
  achievements: ["first_call", "first_sale", "trained"],
  widgets: ["goals", "leaderboard"],
  hidden_widgets: [],
};

// User-editable metadata controls presentation only, never permissions or roles.
export function workspacePreferences(value: unknown): WorkspacePreferences {
  const p =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
    accent: accentOptions.some((a) => a.value === p.accent)
      ? (p.accent as WorkspacePreferences["accent"])
      : "blue",
    density:
      p.density === "compact" || p.density === "spacious"
        ? p.density
        : "comfortable",
    text_size: p.text_size === "large" ? "large" : "standard",
    sidebar: p.sidebar === "matching" ? "matching" : "contrast",
    reduced_motion: p.reduced_motion === true,
    sidebar_mode:
      p.sidebar_mode === "compact" ||
      p.sidebar_mode === "collapsed" ||
      p.sidebar_mode === "wide"
        ? p.sidebar_mode
        : "expanded",
    cards:
      p.cards === "minimal" || p.cards === "rounded" ? p.cards : "standard",
    motion:
      p.motion === "off"
        ? "off"
        : p.motion === "reduced" || p.reduced_motion === true
          ? "reduced"
          : p.motion === "premium"
            ? "premium"
            : "normal",
    navigation_mode: p.navigation_mode === "single" ? "single" : "multiple",
    navigation_open: Array.isArray(p.navigation_open)
      ? [
          ...new Set(
            p.navigation_open.filter(
              (v): v is string =>
                typeof v === "string" &&
                [
                  "My progress",
                  "My sales",
                  "Resources",
                  "Settings & account",
                  "Sales",
                  "People",
                  "Operations",
                ].includes(v),
            ),
          ),
        ]
      : null,
    content_width:
      p.content_width === "wide" || p.content_width === "focused"
        ? p.content_width
        : "balanced",
    font: p.font === "humanist" || p.font === "system" ? p.font : "sans",
    heading_scale:
      p.heading_scale === "compact" || p.heading_scale === "expressive"
        ? p.heading_scale
        : "standard",
    card_surface:
      p.card_surface === "flat" || p.card_surface === "glass"
        ? p.card_surface
        : "solid",
    border_strength: p.border_strength === "defined" ? "defined" : "subtle",
    shadow: p.shadow === "none" || p.shadow === "lifted" ? p.shadow : "soft",
    background:
      p.background === "wash" ||
      p.background === "dots" ||
      p.background === "grid"
        ? p.background
        : "solid",
    buttons:
      p.buttons === "soft" || p.buttons === "pill" ? p.buttons : "standard",
    icon_size: p.icon_size === "large" ? "large" : "standard",
    avatar:
      p.avatar === "monogram" || p.avatar === "outline" ? p.avatar : "initial",
    frame: p.frame === "line" || p.frame === "double" ? p.frame : "simple",
    banner: p.banner === "wash" || p.banner === "grid" ? p.banner : "plain",
    achievements: Array.isArray(p.achievements)
      ? [
          ...new Set(
            p.achievements.filter(
              (x): x is string =>
                typeof x === "string" &&
                ["first_call", "first_sale", "trained"].includes(x),
            ),
          ),
        ].slice(0, 3)
      : ["first_call", "first_sale", "trained"],
    widgets: [
      ...new Set([
        ...(Array.isArray(p.widgets)
          ? p.widgets.filter(
              (x): x is string =>
                typeof x === "string" && ["goals", "leaderboard"].includes(x),
            )
          : []),
        "goals",
        "leaderboard",
      ]),
    ],
    hidden_widgets: Array.isArray(p.hidden_widgets)
      ? [
          ...new Set(
            p.hidden_widgets.filter(
              (x): x is string =>
                typeof x === "string" && ["goals", "leaderboard"].includes(x),
            ),
          ),
        ]
      : [],
    pinned: Array.isArray(p.pinned)
      ? [
          ...new Set(
            p.pinned.filter(
              (v): v is string =>
                typeof v === "string" &&
                /^\/[a-z/]*$/.test(v) &&
                !v.startsWith("//") &&
                v.length < 80,
            ),
          ),
        ].slice(0, 6)
      : [],
  };
}
