import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseClient } from "../services/supabase";
import { createGroup, joinGroup } from "./groups-repository";

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
});
