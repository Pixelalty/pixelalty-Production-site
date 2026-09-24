export const accentOptions = [
  { value: "blue", label: "Pixelalty blue", color: "#245dcc" },
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
};

export const defaultWorkspacePreferences: WorkspacePreferences = {
  theme: "system",
  accent: "blue",
  density: "comfortable",
  text_size: "standard",
  sidebar: "contrast",
  reduced_motion: false,
  pinned: [],
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
