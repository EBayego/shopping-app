import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOutCurrentDevice } from "./auth-repository";

const { signOut, clearCache, cancelQueries, invalidateQueries, removeItem } =
  vi.hoisted(() => ({
    signOut: vi.fn(),
    clearCache: vi.fn(),
    cancelQueries: vi.fn(),
    invalidateQueries: vi.fn(),
    removeItem: vi.fn(),
  }));
vi.mock("expo-linking", () => ({}));
vi.mock("../services/supabase", () => ({
  getSupabaseClient: () => ({ auth: { signOut } }),
}));
vi.mock("../services/secure-store-adapter", () => ({
  secureStoreAdapter: { removeItem },
}));
vi.mock("../offline/sqlite-shopping-store", () => ({
  sqliteShoppingStore: { clearSyncedCache: clearCache },
}));
vi.mock("../lib/query-client", () => ({
  queryClient: { cancelQueries, invalidateQueries },
}));

describe("signOutCurrentDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache.mockResolvedValue(undefined);
    signOut.mockResolvedValue({ error: null });
  });
  it("ends only this device session after clearing synchronized data", async () => {
    await signOutCurrentDevice();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(clearCache.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0]!,
    );
    expect(removeItem).toHaveBeenCalledWith(
      "shopping-app-pending-identity-link",
    );
  });
  it("does not end the session when pending changes would be lost", async () => {
    clearCache.mockRejectedValue(new Error("Cambios pendientes"));
    await expect(signOutCurrentDevice()).rejects.toThrow("Cambios pendientes");
    expect(signOut).not.toHaveBeenCalled();
  });
  it("refreshes the original account if Supabase rejects logout", async () => {
    signOut.mockResolvedValue({ error: new Error("Sin conexión") });
    await expect(signOutCurrentDevice()).rejects.toThrow("Sin conexión");
    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
