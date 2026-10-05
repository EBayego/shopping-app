export function normalizeInviteCode(inviteCode: string): string {
  const value = inviteCode.trim();
  if (!/^(https?|shopping-app(?:-dev|-staging)?):\/\//.test(value))
    return value;
  try {
    const url = new URL(value);
    const path = url.protocol.startsWith("http")
      ? url.pathname
      : `/${url.hostname}${url.pathname}`;
    const match = /^\/(?:preview\/)?join\/([^/]+)\/?$/.exec(path);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : value;
  } catch {
    return value;
  }
}

export function createInviteDeepLink(
  inviteCode: string,
  scheme = process.env.EXPO_PUBLIC_APP_SCHEME?.trim() || "shopping-app",
): string {
  return `${scheme}://join/${encodeURIComponent(normalizeInviteCode(inviteCode))}`;
}

export function getInviteBaseUrl(
  value = process.env.EXPO_PUBLIC_INVITE_BASE_URL?.trim() ||
    "https://shoppingapp.ebia.cloud",
): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "La URL de invitaciones debe ser un dominio HTTPS sin ruta.",
    );
  }
  return url;
}

export function createInviteLink(
  inviteCode: string,
  scheme = process.env.EXPO_PUBLIC_APP_SCHEME?.trim() || "shopping-app",
  baseUrl?: string,
): string {
  const url = getInviteBaseUrl(baseUrl);
  const prefix = scheme === "shopping-app" ? "join" : "preview/join";
  url.pathname = `/${prefix}/${encodeURIComponent(normalizeInviteCode(inviteCode))}`;
  if (scheme !== "shopping-app") url.searchParams.set("scheme", scheme);
  return url.toString();
}
