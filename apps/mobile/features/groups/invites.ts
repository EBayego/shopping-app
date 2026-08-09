export function normalizeInviteCode(inviteCode: string): string {
  return inviteCode.trim();
}

export function createInviteLink(inviteCode: string): string {
  return `shopping-app://join/${encodeURIComponent(normalizeInviteCode(inviteCode))}`;
}
