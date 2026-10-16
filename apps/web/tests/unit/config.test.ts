import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("appConfig", () => {
  it("defaults the display name to Beta", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", "");
    const { appConfig } = await import("@/lib/config");
    expect(appConfig.name).toBe("Beta");
    expect(appConfig.devLoginEnabled).toBe(false);
  });

  it("takes the display name from the environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", "Rally");
    const { appConfig } = await import("@/lib/config");
    expect(appConfig.name).toBe("Rally");
  });
});
