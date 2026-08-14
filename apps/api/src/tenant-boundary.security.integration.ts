import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceDirectory = __dirname;

describe("tenant privileged import architecture", () => {
  it("keeps privileged database imports out of tenant-owned application paths", async () => {
    const allowed = new Map([
      ["app.ts", "composition root"],
      ["platform-admin-create.ts", "platform bootstrap"],
      ["platform-auth.ts", "platform authentication infrastructure"],
      ["platform-tenants.ts", "platform control tenant listing"],
      ["platform-tenant-provisioning.ts", "platform tenant provisioning application service"],
      ["tenant-auth.ts", "tenant pre-auth and session infrastructure"],
      ["tenant-context.ts", "authenticated session identity type only"],
    ]);
    const applicationFiles = (await readdir(sourceDirectory)).filter(
      (file) => file.endsWith(".ts") && !file.includes(".test.") && !file.includes(".integration."),
    );
    const privilegedImports: string[] = [];

    for (const file of applicationFiles) {
      const source = await readFile(join(sourceDirectory, file), "utf8");
      if (source.includes('from "@whatsapp-platform/database/platform"')) {
        privilegedImports.push(file);
      }
    }

    expect(privilegedImports.sort()).toEqual([...allowed.keys()].sort());
    expect(allowed.get("tenant-context.ts")).toContain("type only");
  });
});
