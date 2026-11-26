import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DEFAULT_TONE, eventVars, normalizeHex, type EventVars } from "./tone";

export type ColorScheme = "light" | "dark";

/** A style object that may carry CSS custom properties. */
export type CSSVars = CSSProperties & Partial<Record<`--${string}`, string>>;

// ---------------------------------------------------------------- color scheme

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readScheme(): ColorScheme {
  if (typeof document === "undefined") return "light";
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "light" || forced === "dark") return forced;
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribeScheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  media?.addEventListener("change", onChange);
  const observer =
    typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media?.removeEventListener("change", onChange);
    observer?.disconnect();
  };
}

/** Effective page color scheme: `<html data-theme>` when forced, otherwise prefers-color-scheme. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribeScheme, readScheme, () => "light");
}

// ---------------------------------------------------------------- tone vars

export interface EventThemeValue {
  tone: string;
  coverUrl: string | null;
  scheme: ColorScheme;
}

const EventThemeContext = createContext<EventThemeValue | null>(null);

/**
 * Memoized `eventVars` for a tone as a React style object. Scheme: the explicit one, else the nearest
 * EventThemeProvider's, else the page scheme.
 */
export function useToneVars(tone: string | null | undefined, scheme?: ColorScheme): CSSVars {
  const current = useColorScheme();
  const parent = useContext(EventThemeContext);
  const effective = scheme ?? parent?.scheme ?? current;
  const normalized = normalizeHex(tone) ?? DEFAULT_TONE;
  return useMemo(() => toStyle(eventVars(normalized, effective === "dark")), [normalized, effective]);
}

const isVarName = (key: string): key is `--${string}` => key.startsWith("--");

function toStyle(vars: EventVars): CSSVars {
  const style: CSSVars = {};
  for (const [key, value] of Object.entries(vars)) {
    if (isVarName(key)) style[key] = value;
  }
  return style;
}

type ScopeElement = "div" | "span" | "section" | "main" | "li" | "article";

export interface ToneScopeProps {
  /** `#RRGGBB` event tone. Invalid or missing values fall back to DEFAULT_TONE. */
  tone: string | null | undefined;
  /** Force a scheme for the derived values (the gallery uses it); defaults to the page scheme. */
  scheme?: ColorScheme | undefined;
  as?: ScopeElement | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode;
}

/**
 * Applies an event tone (`--ev`, `--ev-ink`, `--ev-soft`, `--ev-text`, ...) to a subtree.
 * Lightweight: use it per row when a list mixes events (admin), and EventThemeProvider for a page.
 */
export function ToneScope({ tone, scheme, as: Tag = "div", className, style, children }: ToneScopeProps) {
  const vars = useToneVars(tone, scheme);
  const merged = useMemo(() => ({ ...vars, ...style }), [vars, style]);
  return (
    <Tag data-event-theme="" className={className} style={merged}>
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------- page-level provider

export interface EventThemeValue {
  tone: string;
  coverUrl: string | null;
  scheme: ColorScheme;
}


export interface EventThemeProviderProps extends ToneScopeProps {
  /** Same-origin cover URL from the API (`coverUrl`), or null for the tone-only ambient fallback. */
  coverUrl?: string | null | undefined;
}

/**
 * Page theme root: sets the tone vars on its element and exposes `{ tone, coverUrl, scheme }` to
 * AmbientBackground, Hero and anything else that reads `useEventTheme()`.
 */
export function EventThemeProvider({ tone, coverUrl, scheme, children, ...rest }: EventThemeProviderProps) {
  const current = useColorScheme();
  const parent = useContext(EventThemeContext);
  const effective = scheme ?? parent?.scheme ?? current;
  const normalized = normalizeHex(tone) ?? DEFAULT_TONE;
  const value = useMemo<EventThemeValue>(
    () => ({ tone: normalized, coverUrl: coverUrl ?? null, scheme: effective }),
    [normalized, coverUrl, effective],
  );
  return (
    <EventThemeContext.Provider value={value}>
      <ToneScope tone={normalized} scheme={effective} {...rest}>
        {children}
      </ToneScope>
    </EventThemeContext.Provider>
  );
}

/** Nearest page theme; outside a provider: default tone, no cover, page scheme. */
export function useEventTheme(): EventThemeValue {
  const current = useColorScheme();
  const value = useContext(EventThemeContext);
  return value ?? { tone: DEFAULT_TONE, coverUrl: null, scheme: current };
}
