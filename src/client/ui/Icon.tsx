import type { SVGProps } from "react";

type Shape =
  | readonly ["path", string]
  | readonly ["circle", number, number, number]
  | readonly ["rect", number, number, number, number, number];

const p = (d: string): Shape => ["path", d];
const c = (cx: number, cy: number, r: number): Shape => ["circle", cx, cy, r];
const r = (x: number, y: number, w: number, h: number, rx: number): Shape => ["rect", x, y, w, h, rx];

/** Stroke icon set (24px grid, 1.8 stroke, round caps), lucide-compatible geometry as in the canvas. */
const ICONS = {
  "arrow-left": [p("M19 12H5"), p("m12 19-7-7 7-7")],
  "arrow-right": [p("M5 12h14"), p("m12 5 7 7-7 7")],
  "chevron-left": [p("m15 18-6-6 6-6")],
  "chevron-right": [p("m9 18 6-6-6-6")],
  "chevron-down": [p("m6 9 6 6 6-6")],
  "chevron-up": [p("m18 15-6-6-6 6")],
  check: [p("M20 6 9 17l-5-5")],
  x: [p("M18 6 6 18"), p("m6 6 12 12")],
  plus: [p("M12 5v14"), p("M5 12h14")],
  minus: [p("M5 12h14")],
  copy: [r(9, 9, 13, 13, 2), p("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1")],
  share: [p("M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"), p("M16 6l-4-4-4 4"), p("M12 2v13")],
  upload: [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), p("m17 8-5-5-5 5"), p("M12 3v12")],
  download: [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), p("m7 10 5 5 5-5"), p("M12 15V3")],
  file: [p("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"), p("M14 2v4a2 2 0 0 0 2 2h4")],
  "file-text": [
    p("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"),
    p("M14 2v4a2 2 0 0 0 2 2h4"),
    p("M10 9H8"),
    p("M16 13H8"),
    p("M16 17H8"),
  ],
  image: [r(3, 3, 18, 18, 2), c(9, 9, 2), p("m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21")],
  camera: [
    p("M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"),
    c(12, 13, 3),
  ],
  mail: [r(2, 4, 20, 16, 2), p("m22 7-10 6L2 7")],
  phone: [
    p("M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"),
  ],
  whatsapp: [p("M7.9 20A9 9 0 1 0 4 16.1L2 22Z"), p("M9.5 9.5c.5 2 2.5 4.5 5 5l1-1.5 2 1-1 2c-3.5 0-7.5-4-7.5-7.5l2-1 1 2Z")],
  send: [p("M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"), p("m21.854 2.147-10.94 10.939")],
  calendar: [r(3, 4, 18, 18, 2), p("M16 2v4"), p("M8 2v4"), p("M3 10h18")],
  clock: [c(12, 12, 10), p("M12 6v6l4 2")],
  info: [c(12, 12, 10), p("M12 16v-4"), p("M12 8h.01")],
  alert: [
    p("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"),
    p("M12 9v4"),
    p("M12 17h.01"),
  ],
  "alert-circle": [c(12, 12, 10), p("M12 8v4"), p("M12 16h.01")],
  lock: [r(3, 11, 18, 11, 2), p("M7 11V7a5 5 0 0 1 10 0v4")],
  shield: [
    p("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"),
    p("m9 12 2 2 4-4"),
  ],
  search: [c(11, 11, 7), p("m20 20-3.5-3.5")],
  users: [
    p("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
    c(9, 7, 4),
    p("M22 21v-2a4 4 0 0 0-3-3.87"),
    p("M16 3.13a4 4 0 0 1 0 7.75"),
  ],
  user: [p("M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"), c(12, 7, 4)],
  wallet: [
    p("M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"),
    p("M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"),
  ],
  qr: [
    r(3, 3, 7, 7, 1),
    r(14, 3, 7, 7, 1),
    r(3, 14, 7, 7, 1),
    p("M14 14h3v3h-3z"),
    p("M20 14v.01"),
    p("M14 20h.01"),
    p("M17 20h4v-3"),
  ],
  bank: [
    p("M3 22h18"),
    p("M6 18v-7"),
    p("M10 18v-7"),
    p("M14 18v-7"),
    p("M18 18v-7"),
    p("m12 2 8 5H4Z"),
  ],
  receipt: [
    p("M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"),
    p("M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"),
    p("M12 17.5v-11"),
  ],
  external: [p("M15 3h6v6"), p("M10 14 21 3"), p("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")],
  refresh: [
    p("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"),
    p("M21 3v5h-5"),
    p("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"),
    p("M8 16H3v5"),
  ],
  undo: [p("M9 14 4 9l5-5"), p("M4 9h10.5a5.5 5.5 0 0 1 0 11H11")],
  logout: [p("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"), p("m16 17 5-5-5-5"), p("M21 12H9")],
  settings: [
    p("M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"),
    c(12, 12, 3),
  ],
  edit: [p("M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"), p("m15 5 4 4")],
  trash: [p("M3 6h18"), p("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"), p("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")],
  eye: [p("M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"), c(12, 12, 3)],
  filter: [p("M22 3H2l8 9.46V19l4 2v-8.54L22 3z")],
  sparkle: [
    p("M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"),
  ],
  "map-pin": [p("M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"), c(12, 10, 3)],
  bell: [p("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), p("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
  home: [p("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"), p("M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")],
  grid: [r(3, 3, 7, 7, 1.5), r(14, 3, 7, 7, 1.5), r(3, 14, 7, 7, 1.5), r(14, 14, 7, 7, 1.5)],
  list: [p("M8 6h13"), p("M8 12h13"), p("M8 18h13"), p("M3 6h.01"), p("M3 12h.01"), p("M3 18h.01")],
  palette: [
    c(13.5, 6.5, 0.5),
    c(17.5, 10.5, 0.5),
    c(8.5, 7.5, 0.5),
    c(6.5, 12.5, 0.5),
    p("M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"),
  ],
  expand: [p("M15 3h6v6"), p("M9 21H3v-6"), p("M21 3l-7 7"), p("M3 21l7-7")],
  ticket: [
    p("M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"),
    p("M13 5v2"),
    p("M13 17v2"),
    p("M13 11v2"),
  ],
  dot: [c(12, 12, 4)],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  name: IconName;
  /** Pixel size (width and height). Default 20. */
  size?: number | undefined;
  /** Stroke width. Default 1.8 (the canvas uses 2.2-3 for small check marks). */
  strokeWidth?: number | undefined;
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  label?: string | undefined;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, label, ...rest }: IconProps) {
  const shapes: readonly Shape[] = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...rest}
    >
      {shapes.map((shape, i) => {
        switch (shape[0]) {
          case "path":
            return <path key={i} d={shape[1]} />;
          case "circle":
            return <circle key={i} cx={shape[1]} cy={shape[2]} r={shape[3]} fill={name === "dot" ? "currentColor" : undefined} />;
          case "rect":
            return <rect key={i} x={shape[1]} y={shape[2]} width={shape[3]} height={shape[4]} rx={shape[5]} />;
          default:
            return null;
        }
      })}
    </svg>
  );
}
