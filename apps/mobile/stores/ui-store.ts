import { create } from "zustand";

interface UiState {
  isGroupHelpVisible: boolean;
  pendingInviteCode: string | null;
  toggleGroupHelp: () => void;
  setPendingInviteCode: (inviteCode: string) => void;
  clearPendingInviteCode: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isGroupHelpVisible: false,
  pendingInviteCode: null,
  toggleGroupHelp: () =>
    set((state) => ({ isGroupHelpVisible: !state.isGroupHelpVisible })),
  setPendingInviteCode: (inviteCode) =>
    set({ pendingInviteCode: inviteCode.trim() || null }),
  clearPendingInviteCode: () => set({ pendingInviteCode: null }),
}));
