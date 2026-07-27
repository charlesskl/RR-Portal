import { describe, expect, it } from "vitest";

describe("appRoot", () => {
  it("keeps the production base path when redirecting after login", async () => {
    const module = await import("@/lib/appRoot").catch(() => null);

    expect(module?.appRoot("/sprayplan")).toBe("/sprayplan/");
  });

  it("uses the site root for local deployments without a base path", async () => {
    const module = await import("@/lib/appRoot").catch(() => null);

    expect(module?.appRoot("")).toBe("/");
  });
});
