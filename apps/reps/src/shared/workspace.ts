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
  density: "comfortable" | "compact";
  text_size: "standard" | "large";
  sidebar: "contrast" | "matching";
  reduced_motion: boolean;
  pinned: string[];
  sidebar_mode: "expanded" | "compact" | "collapsed";
  cards: "minimal" | "standard" | "rounded";
  motion: "normal" | "reduced" | "off";
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
    density: p.density === "compact" ? "compact" : "comfortable",
    text_size: p.text_size === "large" ? "large" : "standard",
    sidebar: p.sidebar === "matching" ? "matching" : "contrast",
    reduced_motion: p.reduced_motion === true,
    sidebar_mode:
      p.sidebar_mode === "compact" || p.sidebar_mode === "collapsed"
        ? p.sidebar_mode
        : "expanded",
    cards:
      p.cards === "minimal" || p.cards === "rounded" ? p.cards : "standard",
    motion:
      p.motion === "off"
        ? "off"
        : p.motion === "reduced" || p.reduced_motion === true
          ? "reduced"
          : "normal",
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
