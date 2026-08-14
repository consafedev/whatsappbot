import type { Metadata } from "next";
import { TenantListClient } from "./tenant-list-client";

export const metadata: Metadata = { title: "Tenants · Platform Control" };
export const dynamic = "force-dynamic";

export default function PlatformTenantsPage() {
  const apiBaseUrl = (process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "").replace(/\/$/, "");
  return <TenantListClient apiBaseUrl={apiBaseUrl} />;
}
