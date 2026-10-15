import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  automaticallyLinkProducts,
  undoAutomaticProductLinks,
} from "./product-link-repository";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../services/supabase", () => ({
  getSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("../offline/network-state", () => ({ isNetworkOnline: mocks.online }));
vi.mock("../offline/sqlite-shopping-store", () => ({
  sqliteShoppingStore: {
    initialize: () => Promise.resolve(),
    getSyncStatus: mocks.status,
  },
}));
const inputs = {
  retailers: ["DIA"],
  intents: [
    {
      id: "item",
      name: "leche",
      normalizedName: "leche",
      updatedAt: "now",
      requestedQuantity: 1,
      requestedUnit: "l",
    },
  ],
  candidates: [
    {
      intentId: "item",
      productId: "milk",
      productName: "Leche",
      offerId: "offer",
      marketId: "market",
      observedAt: "observed",
      retailer: "DIA",
      classificationAccepted: true,
      classificationConfidence: "HIGH",
      standard: true,
      variableWeight: false,
      normalPrice: 1,
      requiresMembership: false,
      available: true,
      freshness: "FRESH",
      packageSize: 1,
      packageUnit: "l",
    },
  ],
};
describe("product link repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online.mockReturnValue(true);
    mocks.status.mockResolvedValue({ pendingCount: 0, conflictCount: 0 });
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        error: null,
        data:
          name === "get_product_link_inputs"
            ? inputs
            : { batchId: "batch", applied: 1, skipped: 0 },
      }),
    );
  });
  it("loads all comparison candidates once and submits a guarded batch", async () => {
    await expect(
      automaticallyLinkProducts("list", "operation"),
    ).resolves.toEqual({
      batchId: "batch",
      applied: 1,
      skipped: 0,
      unresolved: 0,
      preservedManual: 0,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith("apply_shopping_product_links", {
      operation_id: "operation",
      shopping_list_id: "list",
      choices: [
        {
          intentId: "item",
          updatedAt: "now",
          productId: "milk",
          marketId: "market",
          observedAt: "observed",
        },
      ],
    });
  });
  it("refuses automatic matching offline or while local writes are pending", async () => {
    mocks.online.mockReturnValue(false);
    await expect(
      automaticallyLinkProducts("list", "operation"),
    ).rejects.toThrow("Conéctate");
    mocks.online.mockReturnValue(true);
    mocks.status.mockResolvedValue({ pendingCount: 1, conflictCount: 0 });
    await expect(
      automaticallyLinkProducts("list", "operation"),
    ).rejects.toThrow("Sincroniza");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("checks pending writes again after searching", async () => {
    mocks.status
      .mockResolvedValueOnce({ pendingCount: 0, conflictCount: 0 })
      .mockResolvedValueOnce({ pendingCount: 1, conflictCount: 0 });
    await expect(
      automaticallyLinkProducts("list", "operation"),
    ).rejects.toThrow("Sincroniza");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("undoes through the authorized, idempotent RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(undoAutomaticProductLinks("batch", "undo-op")).resolves.toBe(
      2,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("undo_shopping_product_links", {
      operation_id: "undo-op",
      batch_id: "batch",
    });
  });
});
