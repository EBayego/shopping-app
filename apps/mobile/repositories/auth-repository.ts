import * as Linking from "expo-linking";

import {
  ensureAnonymousSession,
  type EnsuredSession,
} from "../features/auth/anonymous-session";
import { parseOAuthCallbackUrl } from "../features/auth/oauth-callback";
import { secureStoreAdapter } from "../services/secure-store-adapter";
import { getSupabaseClient } from "../services/supabase";

export type SocialIdentityProvider = "google" | "apple";

interface PendingIdentityLink {
  flowId: string | null;
  intent: "link" | "sign-in";
  provider: SocialIdentityProvider;
}

const PENDING_IDENTITY_LINK_KEY = "shopping-app-pending-identity-link";

export async function restoreOrCreateAnonymousSession(): Promise<EnsuredSession> {
  return ensureAnonymousSession(getSupabaseClient().auth);
}

export async function beginSocialIdentityLink(
  provider: SocialIdentityProvider,
): Promise<void> {
  return beginSocialOAuth(provider, "link");
}

export async function beginSocialSignIn(
  provider: SocialIdentityProvider,
): Promise<void> {
  return beginSocialOAuth(provider, "sign-in");
}

async function beginSocialOAuth(
  provider: SocialIdentityProvider,
  intent: "link" | "sign-in",
): Promise<void> {
  const redirectTo = Linking.createURL("auth/callback");
  const auth = getSupabaseClient().auth;
  const { data, error } =
    intent === "link"
      ? await auth.linkIdentity({
          provider,
          options: { redirectTo, skipBrowserRedirect: true },
        })
      : await auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: true },
        });
  if (error) throw error;
  if (!data.url) throw new Error("El proveedor no devolvió una URL de acceso.");

  const pendingLink: PendingIdentityLink = {
    provider,
    flowId: data.flowId ?? null,
    intent,
  };
  await secureStoreAdapter.setItem(
    PENDING_IDENTITY_LINK_KEY,
    JSON.stringify(pendingLink),
  );

  try {
    await Linking.openURL(data.url);
  } catch (linkingError) {
    await secureStoreAdapter.removeItem(PENDING_IDENTITY_LINK_KEY);
    throw linkingError;
  }
}

export async function completeSocialIdentityLink(
  callbackUrl: string,
): Promise<Pick<PendingIdentityLink, "intent" | "provider">> {
  const { code, errorDescription } = parseOAuthCallbackUrl(callbackUrl);
  if (errorDescription) throw new Error(errorDescription);
  if (!code)
    throw new Error("La respuesta de acceso no incluye un código válido.");

  const pendingLink = await readPendingIdentityLink();
  if (!pendingLink) {
    throw new Error("No se encontró un inicio de sesión pendiente.");
  }

  try {
    const { error } = await getSupabaseClient().auth.exchangeCodeForSession(
      code,
      pendingLink.flowId ? { flowId: pendingLink.flowId } : undefined,
    );
    if (error) throw error;
    return { provider: pendingLink.provider, intent: pendingLink.intent };
  } finally {
    await secureStoreAdapter.removeItem(PENDING_IDENTITY_LINK_KEY);
  }
}

async function readPendingIdentityLink(): Promise<PendingIdentityLink | null> {
  const storedLink = await secureStoreAdapter.getItem(
    PENDING_IDENTITY_LINK_KEY,
  );
  if (!storedLink) return null;

  try {
    const parsedLink = JSON.parse(storedLink) as Partial<PendingIdentityLink>;
    if (
      (parsedLink.provider === "google" || parsedLink.provider === "apple") &&
      (parsedLink.intent === "link" || parsedLink.intent === "sign-in") &&
      (typeof parsedLink.flowId === "string" || parsedLink.flowId === null)
    ) {
      return {
        provider: parsedLink.provider,
        flowId: parsedLink.flowId,
        intent: parsedLink.intent,
      };
    }
  } catch {
    // An invalid value is treated as an expired OAuth attempt.
  }
  return null;
}
