import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "../services/supabase";
import {
  listSupermarketsForShoppingList,
  setSupermarketEnabledForShoppingList,
} from "./supermarket-preferences-repository";

vi.mock("../services/supabase", () => ({ getSupabaseClient: vi.fn() }));

describe("supermarket preferences repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enables retailers without an explicit preference", async () => {
    const retailersOrder = vi.fn().mockResolvedValue({
      data: [
        { id: "retailer-1", code: "DIA", name: "DIA" },
        { id: "retailer-2", code: "EROSKI", name: "Eroski" },
      ],
      error: null,
    });
    const preferencesEq = vi.fn().mockResolvedValue({
      data: [{ retailer_id: "retailer-2", enabled: false }],
      error: null,
    });
    const from = vi.fn((table: string) =>
      table === "retailers"
        ? {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ order: retailersOrder })),
            })),
          }
        : {
            select: vi.fn(() => ({ eq: preferencesEq })),
          },
    );
    vi.mocked(getSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof getSupabaseClient>);

    await expect(listSupermarketsForShoppingList("list-1")).resolves.toEqual([
      {
        retailerId: "retailer-1",
        code: "DIA",
        name: "DIA",
        enabled: true,
      },
      {
        retailerId: "retailer-2",
        code: "EROSKI",
        name: "Eroski",
        enabled: false,
      },
    ]);
  });

  it("updates one preference through the authorized RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof getSupabaseClient>);

    await setSupermarketEnabledForShoppingList({
      shoppingListId: "list-1",
      retailerId: "retailer-2",
      enabled: false,
    });

    expect(rpc).toHaveBeenCalledWith("set_shopping_list_retailer_enabled", {
      target_shopping_list_id: "list-1",
      target_retailer_id: "retailer-2",
      target_enabled: false,
    });
  });
});
