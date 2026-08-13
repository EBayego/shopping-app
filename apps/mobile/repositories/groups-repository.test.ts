import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "../services/supabase";
import {
  addShoppingIntent,
  createGroup,
  editShoppingIntent,
  generateGroupInvite,
  joinGroup,
} from "./groups-repository";

vi.mock("../services/supabase", () => ({ getSupabaseClient: vi.fn() }));

function useClient(client: unknown): void {
  vi.mocked(getSupabaseClient).mockReturnValue(
    client as ReturnType<typeof getSupabaseClient>,
  );
}

describe("groups repository RPCs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea grupo y lista inicial mediante la RPC existente", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ group_id: "group-1", shopping_list_id: "list-1" }],
      error: null,
    });
    useClient({ rpc });

    await expect(
      createGroup({
        groupName: " Casa ",
        listName: " Semanal ",
        postalCode: " 28013 ",
      }),
    ).resolves.toEqual({ groupId: "group-1", shoppingListId: "list-1" });
    expect(rpc).toHaveBeenCalledWith("create_group_with_initial_list", {
      group_name: "Casa",
      list_name: "Semanal",
      postal_code: "28013",
    });
  });

  it("se une mediante RPC y reconoce si ya era miembro", async () => {
    const select = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "group-1" }], error: null });
    const rpc = vi.fn().mockResolvedValue({ data: "group-1", error: null });
    useClient({ from: vi.fn().mockReturnValue({ select }), rpc });

    await expect(joinGroup(" ABC123 ")).resolves.toEqual({
      groupId: "group-1",
      outcome: "already-member",
    });
    expect(rpc).toHaveBeenCalledWith("join_group_by_invite", {
      invite_code: "ABC123",
    });
  });

  it("marca como nueva una pertenencia creada por la RPC", async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = vi.fn().mockResolvedValue({ data: "group-2", error: null });
    useClient({ from: vi.fn().mockReturnValue({ select }), rpc });

    await expect(joinGroup("NEWCODE")).resolves.toEqual({
      groupId: "group-2",
      outcome: "joined",
    });
  });

  it("propaga el error server-side de una invitación inválida", async () => {
    const invalidInvite = new Error("Invite code is invalid or expired");
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: invalidInvite });
    useClient({ from: vi.fn().mockReturnValue({ select }), rpc });

    await expect(joinGroup("INVALID")).rejects.toBe(invalidInvite);
  });

  it("genera invitaciones reutilizables para compartir con un grupo", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "ABCD-EF01-2345-6789-ABCD-EF01",
      error: null,
    });
    useClient({ rpc });

    await expect(generateGroupInvite("group-1")).resolves.toBe(
      "ABCD-EF01-2345-6789-ABCD-EF01",
    );
    expect(rpc).toHaveBeenCalledWith("generate_group_invite", {
      target_group_id: "group-1",
      expires_in: "7 days",
      allowed_uses: 100,
    });
  });

  it("asocia un resultado seleccionado con el producto canónico", async () => {
    const intent = {
      id: "intent-1",
      canonical_product_id: "canonical-1",
    };
    const rpc = vi.fn().mockResolvedValue({ data: intent, error: null });
    useClient({ rpc });

    await expect(
      addShoppingIntent(
        "list-1",
        {
          rawText: "Leche semidesnatada",
          normalizedName: "leche semidesnatada",
          canonicalProductId: "canonical-1",
        },
        "operation-1",
      ),
    ).resolves.toBe(intent);
    expect(rpc).toHaveBeenCalledWith("add_shopping_product_operation", {
      operation_id: "operation-1",
      shopping_list_id: "list-1",
      raw_text: "Leche semidesnatada",
      normalized_name: "leche semidesnatada",
      canonical_product_id: "canonical-1",
    });
  });

  it("mantiene un item libre sin asociación canónica", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { id: "intent-2" }, error: null });
    useClient({ rpc });

    await addShoppingIntent(
      "list-1",
      { rawText: "Regalo para Marta", normalizedName: "regalo para marta" },
      "operation-2",
    );
    expect(rpc).toHaveBeenCalledWith("add_shopping_product_operation", {
      operation_id: "operation-2",
      shopping_list_id: "list-1",
      raw_text: "Regalo para Marta",
      normalized_name: "regalo para marta",
    });
  });

  it("edita todos los campos estructurados del item", async () => {
    const intent = { id: "intent-1", normalized_name: "yogur" };
    const rpc = vi.fn().mockResolvedValue({ data: intent, error: null });
    useClient({ rpc });

    await expect(
      editShoppingIntent(
        "intent-1",
        {
          rawText: "Yogur natural",
          normalizedName: "yogur",
          requestedQuantity: 3,
          requestedUnit: "unit",
          packageCount: 3,
          packageSize: 4,
          packageUnit: "unit",
          totalAmount: 12,
          brandPreference: "Danone",
          variant: "natural",
        },
        "operation-3",
      ),
    ).resolves.toBe(intent);
    expect(rpc).toHaveBeenCalledWith("edit_shopping_product_operation", {
      operation_id: "operation-3",
      intent_id: "intent-1",
      raw_text: "Yogur natural",
      normalized_name: "yogur",
      requested_quantity: 3,
      requested_unit: "unit",
      package_count: 3,
      package_size: 4,
      package_unit: "unit",
      total_amount: 12,
      brand_preference: "Danone",
      variant: "natural",
    });
  });
});
