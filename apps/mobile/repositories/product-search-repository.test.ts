import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "../services/supabase";
import { searchProductsForList } from "./product-search-repository";
import { listSupermarketsForShoppingList } from "./supermarket-preferences-repository";

vi.mock("../services/supabase", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("./supermarket-preferences-repository", () => ({
  listSupermarketsForShoppingList: vi.fn(),
}));

describe("product search repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSupermarketsForShoppingList).mockResolvedValue([
      {
        retailerId: "retailer-1",
        code: "MERCADONA",
        name: "Mercadona",
        enabled: true,
      },
    ]);
  });

  it("uses only the authorized backend RPC with list context", async () => {
    const data = [
      {
        canonicalProduct: { id: "canonical-1" },
        retailerProducts: [],
        offers: [],
      },
    ];
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof getSupabaseClient>);

    await expect(
      searchProductsForList("list-1", " leche ", 10),
    ).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledWith("search_products_for_list", {
      shopping_list_id: "list-1",
      query: "leche",
      result_limit: 10,
    });
  });

  it("removes products and offers from disabled supermarkets", async () => {
    const data = [
      {
        canonicalProduct: null,
        retailerProducts: [
          { retailerId: "retailer-1" },
          { retailerId: "retailer-2" },
        ],
        offers: [
          { retailer: { id: "retailer-1" } },
          { retailer: { id: "retailer-2" } },
        ],
      },
    ];
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof getSupabaseClient>);
    vi.mocked(listSupermarketsForShoppingList).mockResolvedValue([
      {
        retailerId: "retailer-1",
        code: "MERCADONA",
        name: "Mercadona",
        enabled: true,
      },
      {
        retailerId: "retailer-2",
        code: "EROSKI",
        name: "Eroski",
        enabled: false,
      },
    ]);

    const [result] = await searchProductsForList("list-1", "leche");
    expect(result?.retailerProducts).toEqual([{ retailerId: "retailer-1" }]);
    expect(result?.offers).toEqual([{ retailer: { id: "retailer-1" } }]);
  });

  it("rejects a malformed backend response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof getSupabaseClient>);

    await expect(searchProductsForList("list-1", "leche")).rejects.toThrow(
      "respuesta inválida",
    );
  });
});
