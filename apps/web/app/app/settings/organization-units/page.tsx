import { TenantAppSettingsNav } from "../../tenant-app-settings-nav";
import { TenantAppOrganizationUnits } from "./tenant-app-organization-units";

export const dynamic = "force-dynamic";

export default function TenantAppOrganizationUnitsPage() {
  return (
    <>
      <TenantAppSettingsNav />
      <TenantAppOrganizationUnits />
    </>
  );
}
