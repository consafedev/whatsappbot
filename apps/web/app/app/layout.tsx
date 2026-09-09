import type { ReactNode } from "react";
import { TenantAppShell } from "./tenant-app-shell";

export default function TenantAppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(
    /\/$/,
    "",
  );
  return <TenantAppShell apiBaseUrl={apiBaseUrl}>{children}</TenantAppShell>;
}
