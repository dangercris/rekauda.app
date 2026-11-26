/** Class identity copy derived from GET /api/config (with fallbacks while it loads or fails). */

import { CLASS_NAME, CLASS_SHORT_NAME, SCHOOL_NAME } from "../../../shared/instance";

export const FALLBACK_CLASS_NAME: string = CLASS_NAME;
export const FALLBACK_SCHOOL_NAME: string = SCHOOL_NAME;

export function footerText(className: string, schoolName: string): string {
  return `Sitio de los padres de familia de ${className}. No es un sitio oficial de ${schoolName}.`;
}

/** Document title of the home page ("Recaudaciones <short class label>"). */
export function homeTitle(): string {
  return `Recaudaciones ${CLASS_SHORT_NAME}`;
}

export function collectionTitle(title: string): string {
  return `${title} · ${CLASS_SHORT_NAME}`;
}
