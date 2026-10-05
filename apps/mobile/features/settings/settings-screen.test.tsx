import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsScreen from "../../app/settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { account, beginLink, beginSignIn, signOut, replace, alert } = vi.hoisted(
  () => ({
    account: {
      anonymous: true,
      providers: [] as string[],
      hasGroups: false,
      syncing: false,
    },
    beginLink: vi.fn().mockResolvedValue(undefined),
    beginSignIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn(),
    alert: vi.fn(),
  }),
);
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: <T,>(value: T) => value },
  Alert: { alert },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { replace },
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("../auth/session-provider", () => ({
  useSession: () => ({
    status: "ready",
    session: {
      user: {
        id: "user-1",
        is_anonymous: account.anonymous,
        identities: account.providers.map((provider) => ({ provider })),
      },
    },
  }),
}));
vi.mock("../groups/queries", () => ({
  useGroupsQuery: () => ({
    data: account.hasGroups ? [{ id: "group-1" }] : [],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("./queries", () => ({
  useProfileQuery: () => ({
    data: { display_name: "Edu" },
    isLoading: false,
    isError: false,
  }),
  useUpdateProfileMutation: () => ({ reset: vi.fn(), mutate: vi.fn() }),
}));
vi.mock("../../offline/offline-sync-provider", () => ({
  useOfflineSync: () => ({ isSyncing: account.syncing }),
}));
vi.mock("../../repositories/auth-repository", () => ({
  beginSocialIdentityLink: beginLink,
  beginSocialSignIn: beginSignIn,
  signOutCurrentDevice: signOut,
}));

describe("Settings account options", () => {
  beforeEach(() => {
    Object.assign(account, {
      anonymous: true,
      providers: [],
      hasGroups: false,
      syncing: false,
    });
    vi.clearAllMocks();
    signOut.mockResolvedValue(undefined);
  });

  it("offers only sign-in when an anonymous identity has no shopping data", async () => {
    const renderer = await renderSettings();
    expect(textOf(renderer.root)).not.toContain("Protege tu cuenta");
    expect(textOf(renderer.root)).not.toContain("Vincular con");
    expect(buttons(renderer)).toContain("Iniciar sesión con Google");
    expect(buttons(renderer)).toContain("Iniciar sesión con Apple");
    await press(renderer, "Iniciar sesión con Google");
    expect(beginSignIn).toHaveBeenCalledWith("google");
    expect(alert).not.toHaveBeenCalled();
  });

  it("offers linking for an anonymous account with lists and confirms account replacement", async () => {
    account.hasGroups = true;
    const renderer = await renderSettings();
    expect(textOf(renderer.root)).toContain("Protege tu cuenta");
    await press(renderer, "Vincular con Google");
    expect(beginLink).toHaveBeenCalledWith("google");
    await press(renderer, "Iniciar sesión con Google");
    expect(alert).toHaveBeenCalled();
    expect(beginSignIn).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"])(
    "shows only the linked %s provider and logout for a signed-in account",
    async (provider) => {
      account.anonymous = false;
      account.providers = [provider];
      const renderer = await renderSettings();
      expect(buttons(renderer)).toEqual([
        "Guardar nombre",
        `${provider === "google" ? "Google" : "Apple"} vinculado`,
        "Cerrar sesión",
      ]);
      await press(renderer, "Cerrar sesión");
      expect(signOut).toHaveBeenCalledOnce();
      expect(replace).toHaveBeenCalledWith("/settings");
    },
  );

  it("keeps account access and shows a logout error when local changes are pending", async () => {
    account.anonymous = false;
    account.providers = ["google"];
    signOut.mockRejectedValue(new Error("Hay cambios locales pendientes."));
    const renderer = await renderSettings();
    await press(renderer, "Cerrar sesión");
    expect(textOf(renderer.root)).toContain("Hay cambios locales pendientes.");
    expect(replace).not.toHaveBeenCalled();
  });
});

async function renderSettings(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<SettingsScreen />);
    await Promise.resolve();
  });
  return renderer!;
}
function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
function buttons(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByProps({ accessibilityRole: "button" })
    .map(textOf);
}
async function press(
  renderer: ReactTestRenderer,
  label: string,
): Promise<void> {
  const button = renderer.root
    .findAllByProps({ accessibilityRole: "button" })
    .find((node) => textOf(node) === label);
  const handler: unknown = button?.props.onPress;
  if (typeof handler !== "function")
    throw new Error(`Missing button: ${label}`);
  await act(async () => {
    (handler as () => void)();
    await Promise.resolve();
  });
}
