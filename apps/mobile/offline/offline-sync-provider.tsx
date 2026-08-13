import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  onlineManager,
  useQueryClient,
} from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { useSession } from "../features/auth/session-provider";
import { groupKeys } from "../features/groups/query-keys";
import { getErrorMessage } from "../lib/errors";
import { setNetworkOnline } from "./network-state";
import { shoppingSyncEngine } from "./offline-shopping-repository";
import { sqliteShoppingStore } from "./sqlite-shopping-store";
import type { LocalSyncStatus } from "./types";

interface OfflineSyncValue extends LocalSyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  syncNow: () => void;
  refreshStatus: () => Promise<void>;
}

const EMPTY_STATUS: LocalSyncStatus = {
  pendingCount: 0,
  conflictCount: 0,
  lastError: null,
  lastSyncedAt: null,
};

const OfflineSyncContext = createContext<OfflineSyncValue | null>(null);

export function OfflineSyncProvider({ children }: PropsWithChildren) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState<LocalSyncStatus>(EMPTY_STATUS);
  const running = useRef<Promise<void> | null>(null);
  const rerunRequested = useRef(false);
  const onlineRef = useRef(true);
  const profileId = session.status === "ready" ? session.session.user.id : null;

  const refreshStatus = useCallback(async () => {
    await sqliteShoppingStore.initialize();
    setStatus(await sqliteShoppingStore.getSyncStatus());
  }, []);

  const syncNow = useCallback(() => {
    if (!onlineRef.current || !profileId) return;
    if (running.current) {
      rerunRequested.current = true;
      return;
    }
    setIsSyncing(true);
    const task = shoppingSyncEngine
      .sync()
      .then(async () => {
        await refreshStatus();
        await queryClient.invalidateQueries({ queryKey: groupKeys.root });
      })
      .catch(async (error: unknown) => {
        const message = getErrorMessage(error);
        try {
          await sqliteShoppingStore.recordSyncError(message);
          await refreshStatus();
        } catch (statusError) {
          setStatus((current) => ({
            ...current,
            lastError: getErrorMessage(statusError),
          }));
        }
      })
      .finally(() => {
        running.current = null;
        setIsSyncing(false);
        if (rerunRequested.current) {
          rerunRequested.current = false;
          queueMicrotask(syncNow);
        }
      });
    running.current = task;
  }, [profileId, queryClient, refreshStatus]);

  useEffect(() => {
    void refreshStatus();
    return NetInfo.addEventListener((network) => {
      const connected =
        network.isConnected === true && network.isInternetReachable !== false;
      onlineRef.current = connected;
      setNetworkOnline(connected);
      setIsOnline(connected);
      onlineManager.setOnline(connected);
      if (connected) syncNow();
    });
  }, [refreshStatus, syncNow]);

  useEffect(() => {
    if (!profileId) return;
    void queryClient.invalidateQueries(
      { queryKey: groupKeys.root },
      { cancelRefetch: false },
    );
    syncNow();
  }, [profileId, queryClient, syncNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      focusManager.setFocused(active);
      if (active) syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);

  const value = useMemo<OfflineSyncValue>(
    () => ({ ...status, isOnline, isSyncing, syncNow, refreshStatus }),
    [isOnline, isSyncing, refreshStatus, status, syncNow],
  );
  return (
    <OfflineSyncContext.Provider value={value}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncValue {
  const value = useContext(OfflineSyncContext);
  if (!value)
    throw new Error("useOfflineSync must be used inside OfflineSyncProvider");
  return value;
}
