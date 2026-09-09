import { type NextRequest, NextResponse } from "next/server";

const LOOPBACK_ALIASES = new Set(["127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * Canonicalizes the workspace origin to `localhost`.
 *
 * The API enforces an exact-origin CORS allowlist (SECURITY.md: "Origin exacto
 * y CORS explícito para mutaciones con cookie") and issues `SameSite=Strict`
 * session cookies scoped to its own host, `http://localhost:3001`. A page
 * opened through `http://127.0.0.1:3005` is a different browser origin:
 * CORS preflights are rejected and Strict cookies would never be attached, so
 * login can never work from that alias. Redirecting to the canonical host
 * keeps a single trusted origin instead of widening the API allowlist.
 */
export function proxy(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const hostHeader = (request.headers.get("host") ?? "").toLowerCase();

  // IPv6 literals are bracketed in the Host header (e.g. "[::1]:3005"); a
  // naive split on ":" would truncate them at the first colon.
  const isBracketed = hostHeader.startsWith("[");
  const requestHost = isBracketed
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : (hostHeader.split(":")[0] ?? "");
  const requestPort = isBracketed
    ? (hostHeader.split("]:")[1] ?? "")
    : (hostHeader.split(":")[1] ?? "");

  if (!LOOPBACK_ALIASES.has(requestHost)) {
    return NextResponse.next();
  }

  // Rebuild the destination from the client's Host header: request.url is
  // derived from the internal container bind (PORT=3000), which differs from
  // the externally mapped port (WEB_PORT=3005) and would send users there.
  const canonicalUrl = new URL(requestUrl.toString());
  canonicalUrl.hostname = "localhost";
  canonicalUrl.port = requestPort !== "" && requestPort !== "80" ? requestPort : "";

  return NextResponse.redirect(canonicalUrl, 308);
}
