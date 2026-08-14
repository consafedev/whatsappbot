import type { Metadata } from "next";
import { TenantDetailClient } from "./tenant-detail-client";

export const metadata: Metadata = { title: "Detalle de tenant · Platform Control" };
export const dynamic = "force-dynamic";

export default async function PlatformTenantDetailPage({
  params,
}: Readonly<{ params: Promise<{ tenantId: string }> }>) {
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  const { tenantId } = await params;
  return <TenantDetailClient apiBaseUrl={apiBaseUrl} tenantId={tenantId} />;
}
