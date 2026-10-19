import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IndexScreen from "../../app/index";
import type { GroupSummary } from "../groups/types";
import { readLastGroup, rememberLastScreen } from "./last-screen-storage";
import { NavigationPersistence } from "./navigation-persistence";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { app, values, getItem, setItem, removeItem, reset, navigation } =
  vi.hoisted(() => {
    const reset = vi.fn();
    return {
      app: {
        pathname: "/",
        profileId: "user-1",
        sessionStatus: "ready",
        groups: {
          data: [] as GroupSummary[] | undefined,
          isLoading: false,
        },
      },
      values: new Map<string, string>(),
      getItem: vi.fn<(key: string) => Promise<string | null>>(),
      setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
      removeItem: vi.fn<(key: string) => Promise<void>>(),
      reset,
      navigation: { reset },
    };
  });

vi.mock("expo-router", () => ({
  usePathname: () => app.pathname,
  useNavigation: () => navigation,
}));
vi.mock("../auth/session-provider", () => ({
  useSession: () => ({
    status: app.sessionStatus,
    session: { user: { id: app.profileId } },
  }),
}));
vi.mock("../groups/queries", () => ({
  useGroupsQuery: () => app.groups,
}));
vi.mock("../../services/secure-store-adapter", () => ({
  secureStoreAdapter: { getItem, setItem, removeItem },
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("../../components/screen-state", () => ({
  ScreenState: () => null,
}));

const HOME_STATE = { index: 0, routes: [{ name: "groups/index" }] };
const GROUPS: GroupSummary[] = ["group-1", "group-2"].map((id) => ({
  id,
  name: id,
  createdAt: "2026-10-19T00:00:00Z",
}));

let renderer: ReactTestRenderer | undefined;

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
    await Promise.resolve();
  });
}

async function close(): Promise<void> {
  await act(() => renderer?.unmount());
  renderer = undefined;
}

function expectGroup(groupId: string): void {
  expect(reset).toHaveBeenLastCalledWith({
    index: 1,
    routes: [
      { name: "groups/index" },
      { name: "groups/[groupId]", params: { groupId } },
    ],
  });
}

describe("navigation resume", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    values.clear();
    Object.assign(app, {
      pathname: "/",
      profileId: "user-1",
      sessionStatus: "ready",
      groups: { data: GROUPS, isLoading: false },
    });
    getItem.mockImplementation((key) =>
      Promise.resolve(values.get(key) ?? null),
    );
    setItem.mockImplementation((key, value) => {
      values.set(key, value);
      return Promise.resolve();
    });
    removeItem.mockImplementation((key) => {
      values.delete(key);
      return Promise.resolve();
    });
  });

  afterEach(close);

  it("restores the latest group across launches and keeps Home behind it", async () => {
    app.pathname = "/groups/group-1";
    await render(<NavigationPersistence />);
    app.pathname = "/groups/group-2";
    await render(<NavigationPersistence />);
    await close();

    app.pathname = "/";
    await render(
      <>
        <NavigationPersistence />
        <IndexScreen />
      </>,
    );
    expectGroup("group-2");
  });

  it.each(["/groups", "/settings", "/groups/settings/group-1"])(
    "opens Home after closing on %s instead of restoring a previously opened group",
    async (pathname) => {
      await rememberLastScreen("user-1", "/groups/group-1");
      app.pathname = pathname;
      await render(<NavigationPersistence />);
      await close();

      app.pathname = "/";
      await render(<IndexScreen />);
      expect(reset).toHaveBeenLastCalledWith(HOME_STATE);
    },
  );

  it("opens Home on the first launch", async () => {
    await render(<IndexScreen />);
    expect(reset).toHaveBeenLastCalledWith(HOME_STATE);
  });

  it("waits for session restoration before reading or saving navigation", async () => {
    await rememberLastScreen("user-1", "/groups/group-1");
    app.sessionStatus = "loading";
    await render(
      <>
        <NavigationPersistence />
        <IndexScreen />
      </>,
    );
    expect(getItem).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    app.sessionStatus = "ready";
    await render(
      <>
        <NavigationPersistence />
        <IndexScreen />
      </>,
    );
    expectGroup("group-1");
  });

  it("waits for the group list and can restore groups available from the offline cache", async () => {
    await rememberLastScreen("user-1", "/groups/group-1");
    app.groups = { data: undefined, isLoading: true };
    await render(<IndexScreen />);
    expect(reset).not.toHaveBeenCalled();

    app.groups = { data: GROUPS, isLoading: false };
    await render(<IndexScreen />);
    expectGroup("group-1");
  });

  it("falls back to Home when the stored group is no longer available", async () => {
    await rememberLastScreen("user-1", "/groups/deleted-group");
    await render(<IndexScreen />);
    expect(reset).toHaveBeenLastCalledWith(HOME_STATE);
  });

  it("does not restore a different account's group", async () => {
    await rememberLastScreen("user-1", "/groups/group-1");
    app.profileId = "user-2";
    await render(<IndexScreen />);
    expect(reset).toHaveBeenLastCalledWith(HOME_STATE);
    expect(await readLastGroup("user-1")).toBe("group-1");
  });

  it("falls back to Home if reading the preference fails", async () => {
    getItem.mockRejectedValue(new Error("Storage unavailable"));
    await render(<IndexScreen />);
    expect(reset).toHaveBeenLastCalledWith(HOME_STATE);
  });

  it("preserves explicit invitation links instead of navigating to a saved group", async () => {
    await rememberLastScreen("user-1", "/groups/group-1");
    app.pathname = "/join/123456";
    await render(<NavigationPersistence />);
    expect(reset).not.toHaveBeenCalled();
    expect(await readLastGroup("user-1")).toBeNull();
  });

  it("serializes rapid screen changes so an older save cannot replace Home", async () => {
    let finishSave: (() => void) | undefined;
    setItem.mockImplementationOnce(
      (key, value) =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            values.set(key, value);
            resolve();
          };
        }),
    );
    const save = rememberLastScreen("user-1", "/groups/group-1");
    const clear = rememberLastScreen("user-1", "/settings");
    await Promise.resolve();
    expect(removeItem).not.toHaveBeenCalled();
    expect(finishSave).toBeDefined();
    finishSave!();
    await Promise.all([save, clear]);
    expect(await readLastGroup("user-1")).toBeNull();
  });

  it("can save another screen after a failed write", async () => {
    setItem.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(
      rememberLastScreen("user-1", "/groups/group-1"),
    ).rejects.toThrow("Storage unavailable");
    await rememberLastScreen("user-1", "/groups/group-2");
    expect(await readLastGroup("user-1")).toBe("group-2");
  });
});
