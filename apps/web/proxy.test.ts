import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

/**
 * Builds a request the way the Next.js server does in production: the URL is
 * derived from the client's request line, and the Host header mirrors the host
 * the browser actually used (e.g. `127.0.0.1:3005`).
 */
function buildRequest(url: string, host: string): NextRequest {
  return new NextRequest(url, { headers: { host } });
}

describe("canonical-host proxy", () => {
  it("redirects 127.0.0.1 to localhost preserving path and query with 308", () => {
    const request = buildRequest(
      "http://127.0.0.1:3005/app/contacts?search=ana&page=2",
      "127.0.0.1:3005",
    );

    const response = proxy(request);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3005/app/contacts?search=ana&page=2",
    );
  });

  it("redirects IPv6 loopback alias [::1] to localhost", () => {
    const response = proxy(buildRequest("http://[::1]:3005/app/inbox", "[::1]:3005"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3005/app/inbox");
  });

  it("redirects 0.0.0.0 alias to localhost", () => {
    const response = proxy(buildRequest("http://0.0.0.0:3005/", "0.0.0.0:3005"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3005/");
  });

  it("uses the client-facing port from the Host header, not the internal bind port", () => {
    // Simulates the Docker topology: browser asks for 127.0.0.1:3005 while the
    // container internally serves on 3000 (request.url would carry :3000).
    const request = new NextRequest("http://127.0.0.1:3000/app/contacts", {
      headers: { host: "127.0.0.1:3005" },
    });

    const response = proxy(request);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3005/app/contacts");
  });

  it("passes through requests already on localhost", () => {
    const response = proxy(buildRequest("http://localhost:3005/app/campaigns", "localhost:3005"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes through requests on other hosts (e.g. a LAN deployment hostname)", () => {
    const response = proxy(
      buildRequest("http://intranet.local:3005/app/users", "intranet.local:3005"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
