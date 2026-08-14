import type { Metadata } from "next";
import { TenantProvisioningClient } from "./tenant-provisioning-client";

export const metadata: Metadata = { title: "Crear tenant · Platform Control" };
export const dynamic = "force-dynamic";

export default function NewPlatformTenantPage() {
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  return <TenantProvisioningClient apiBaseUrl={apiBaseUrl} />;
}
