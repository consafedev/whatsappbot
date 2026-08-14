import { describe, expect, it } from "vitest";
import {
  defaultTenantModules,
  provisioningErrorMessage,
  tenantProvisioningPayload,
} from "./tenant-provisioning-view-model";

const form = {
  channelAccounts: "1",
  defaultCurrency: "MXN",
  defaultLocale: "es-MX",
  defaultTimezone: "America/Mexico_City",
  deploymentId: "",
  displayName: "Acme",
  enabledModules: [...defaultTenantModules],
  legalName: "Acme SA",
  monthlyAiBudget: "0",
  organizationUnits: "1",
  ownerDisplayName: "Owner",
  ownerEmail: "owner@example.invalid",
  ownerPassword: "a secure initial password",
  slug: "acme",
  storageBytes: "0",
  users: "1",
};

describe("tenant provisioning view model", () => {
  it("starts only with the two documented MVP modules", () => {
    expect(defaultTenantModules).toEqual(["module.messaging.basic", "module.automation.basic"]);
  });

  it("maps visible form values without inventing deployment or commercial defaults", () => {
    expect(tenantProvisioningPayload(form)).toMatchObject({
      deploymentId: null,
      enabledModules: defaultTenantModules,
      limits: { channelAccounts: 1, organizationUnits: 1, users: 1 },
    });
  });

  it("keeps password only in the request object and maps safe HTTP errors", () => {
    const payload = tenantProvisioningPayload(form);
    expect(payload.owner.password).toBe(form.ownerPassword);
    expect(
      JSON.stringify({ ...payload, owner: { ...payload.owner, password: undefined } }),
    ).not.toContain(form.ownerPassword);
    expect(provisioningErrorMessage(409)).toContain("slug");
    expect(provisioningErrorMessage(401)).toContain("sesión");
  });
});
