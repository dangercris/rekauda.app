/** Class identity copy. The names come from the tenant's config (useInstanceConfig), never from module constants. */

export function footerText(className: string, schoolName: string): string {
  return `Sitio de los padres de familia de ${className}. No es un sitio oficial de ${schoolName}.`;
}

/** Document title of the home page ("Recaudaciones <short class label>"). */
export function homeTitle(classShortName: string): string {
  return `Recaudaciones ${classShortName}`;
}

export function collectionTitle(title: string, classShortName: string): string {
  return `${title} · ${classShortName}`;
}
