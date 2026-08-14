import type { Metadata } from "next";
import { TenantListClient } from "./tenant-list-client";

export const metadata: Metadata = { title: "Tenants · Platform Control" };
export const dynamic = "force-dynamic";

export default async function PlatformTenantsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ created?: string }> }>) {
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  const { created } = await searchParams;
  return <TenantListClient apiBaseUrl={apiBaseUrl} createdSlug={created ?? null} />;
}
