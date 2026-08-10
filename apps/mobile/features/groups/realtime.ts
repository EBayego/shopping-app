import type { QueryClient } from "@tanstack/react-query";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useEffect } from "react";
import { AppState } from "react-native";

import { getSupabaseClient } from "../../services/supabase";
import { groupKeys } from "./queries";
import { createRefetchScheduler } from "./reconciliation";

export function subscribeToGroupBroadcast(
  groupId: string,
  queryClient: QueryClient,
): () => void {
  const supabase = getSupabaseClient();
  let disposed = false;
  let channel: ReturnType<typeof supabase.channel> | undefined;
  const reconcile = createRefetchScheduler(() => {
    void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) });
  });

  void supabase.realtime.setAuth().then(() => {
    if (disposed) return;
    channel = supabase
      .channel(`group:${groupId}`, { config: { private: true } })
      .on("broadcast", { event: "*" }, reconcile)
      .subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) reconcile();
      });
  });

  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") reconcile();
  });

  return () => {
    disposed = true;
    appStateSubscription.remove();
    if (channel) void supabase.removeChannel(channel);
  };
}

export function useGroupRealtime(
  groupId: string,
  enabled: boolean,
  queryClient: QueryClient,
): void {
  useEffect(() => {
    if (!enabled || !groupId) return undefined;
    return subscribeToGroupBroadcast(groupId, queryClient);
  }, [enabled, groupId, queryClient]);
}
