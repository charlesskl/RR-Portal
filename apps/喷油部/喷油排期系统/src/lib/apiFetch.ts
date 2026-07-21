const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * Client-side API requests must include the Portal sub-path in production.
 * Server-side calls continue to use dotnetGet() and the internal API address.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === "string" && input.startsWith("/api")) {
    return fetch(`${basePath}${input}`, init);
  }
  return fetch(input, init);
}
