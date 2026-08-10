export function normalizeInviteCode(inviteCode: string): string {
  return inviteCode.trim();
}

export function createInviteLink(
  inviteCode: string,
  scheme = process.env.EXPO_PUBLIC_APP_SCHEME?.trim() || "shopping-app",
): string {
  return `${scheme}://join/${encodeURIComponent(normalizeInviteCode(inviteCode))}`;
}
