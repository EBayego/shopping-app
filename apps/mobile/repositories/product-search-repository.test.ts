import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "../services/supabase";
import { searchProductsForList } from "./product-search-repository";

vi.mock("../services/supabase", () => ({ getSupabaseClient: vi.fn() }));

describe("product search repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses only the authorized backend RPC with list context", async () => {
    const data = [{ canonicalProduct: null, retailerProducts: [], offers: [] }];
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
