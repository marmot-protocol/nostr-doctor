// ---------------------------------------------------------------------------
// Routing helpers — shared across report flow and sign-in pages.
// Pure functions with no React or context dependencies.
// ---------------------------------------------------------------------------

export const REPORT_PAGE_BASE = "/r";

/** Build the full path for a diagnostic report page by name. */
export function pagePath(name: string): string {
  return `${REPORT_PAGE_BASE}/${name}`;
}

/**
 * Parse redirect from location search. Returns a path only if it's safe:
 * starts with "/" and contains no "//" (avoids protocol-relative or external URLs).
 */
export function getSafeRedirect(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("redirect");
  if (raw != null && raw.startsWith("/") && !raw.includes("//")) return raw;
  return null;
}
