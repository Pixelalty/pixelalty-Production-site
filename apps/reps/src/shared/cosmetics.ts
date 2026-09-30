export type CosmeticKind = "avatar" | "frame" | "banner";
export type Cosmetic = {
  id: string;
  name: string;
  xp: number;
  animated: boolean;
};
const tier = (xp: number, names: string[], animated = false): Cosmetic[] =>
  names.map((name) => ({
    id: name.toLowerCase().replaceAll(" ", "_"),
    name,
    xp,
    animated,
  }));
export const cosmeticCatalog: Record<CosmeticKind, Cosmetic[]> = {
  avatar: [
    ...tier(0, [
      "Initial",
      "Monogram",
      "Outline",
      "Solid",
      "Gradient",
      "Pixel",
      "Minimal Badge",
    ]),
    ...tier(1000, ["Dual Tone", "Halo", "Glass", "Carbon", "Prism"]),
    ...tier(
      10000,
      ["Animated Halo", "Orbit", "Pulse", "Moving Gradient", "Energy Ring"],
      true,
    ),
    ...tier(
      50000,
      ["Aurora", "Holographic", "Geometry", "Constellation"],
      true,
    ),
  ],
  frame: [
    ...tier(0, ["Simple", "Line", "Double", "Soft", "Squared", "Minimal Ring"]),
    ...tier(1000, [
      "Accent Ring",
      "Split Ring",
      "Corners",
      "Technical",
      "Pixel Edge",
      "Layered",
    ]),
    ...tier(10000, ["Pulse", "Orbit", "Neon", "Moving Dashes", "Energy"], true),
    ...tier(
      50000,
      ["Holographic", "Aurora", "Comet", "Geometry", "Dynamic Wave"],
      true,
    ),
  ],
  banner: [
    ...tier(0, [
      "Plain",
      "Wash",
      "Grid",
      "Gradient",
      "Dots",
      "Lines",
      "Soft Mesh",
    ]),
    ...tier(1000, [
      "Blueprint",
      "Pixel Field",
      "Contours",
      "Waves",
      "Geometric",
      "Horizon",
    ]),
    ...tier(
      10000,
      [
        "Animated Gradient",
        "Flowing Mesh",
        "Moving Grid",
        "Scanning Line",
        "Orbiting Shapes",
      ],
      true,
    ),
    ...tier(
      50000,
      [
        "Aurora",
        "Holographic",
        "Constellation",
        "Comet Trails",
        "Pixelalty Motif",
      ],
      true,
    ),
  ],
};
export type ProfileStyle = {
  avatar: string;
  frame: string;
  banner: string;
  accent: string;
  avatar_asset: string | null;
  banner_asset: string | null;
  avatar_x: number;
  avatar_y: number;
  banner_x: number;
  banner_y: number;
  banner_fit: "cover" | "contain";
};
export const defaultProfileStyle: ProfileStyle = {
  avatar: "initial",
  frame: "simple",
  banner: "wash",
  accent: "blue",
  avatar_asset: null,
  banner_asset: null,
  avatar_x: 50,
  avatar_y: 50,
  banner_x: 50,
  banner_y: 50,
  banner_fit: "cover",
};
export const cosmeticTiers = [0, 1000, 10000, 50000] as const;
export function mediaUnlock(kind: "avatar" | "banner", animated: boolean) {
  return animated ? (kind === "banner" ? 50000 : 10000) : 1000;
}

export function profileStyle(
  value: Partial<ProfileStyle> | undefined,
): ProfileStyle {
  return Object.fromEntries(
    Object.entries(defaultProfileStyle).map(([key, fallback]) => [
      key,
      value?.[key as keyof ProfileStyle] ?? fallback,
    ]),
  ) as ProfileStyle;
}
