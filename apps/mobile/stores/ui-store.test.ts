import { afterEach, describe, expect, it } from "vitest";

import { useUiStore } from "./ui-store";

describe("pending invite", () => {
  afterEach(() => useUiStore.getState().clearPendingInviteCode());

  it("conserva la invitación mientras el usuario pasa por onboarding", () => {
    useUiStore.getState().setPendingInviteCode("  ABC123  ");

    // Cambiar otro estado de UI simula que onboarding se monta y opera sobre el store.
    useUiStore.getState().toggleGroupHelp();

    expect(useUiStore.getState().pendingInviteCode).toBe("ABC123");
  });
});
