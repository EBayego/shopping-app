import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../auth/session-provider";
import {
  createGroup,
  generateGroupInvite,
  joinGroup,
} from "../../repositories/groups-repository";
import {
  createLocalIntent,
  enqueueShoppingOperation,
  getOfflineGroupDetail,
  listOfflineGroups,
} from "../../offline/offline-shopping-repository";
import { useOfflineSync } from "../../offline/offline-sync-provider";
import type { AddShoppingIntentInput } from "./types";

export const groupKeys = {
  all: ["groups"] as const,
  detail: (groupId: string) => ["groups", groupId] as const,
};

export function useGroupsQuery() {
  const session = useSession();
  return useQuery({
    queryKey: groupKeys.all,
    queryFn: listOfflineGroups,
    enabled: session.status === "ready",
  });
}

export function useGroupDetailQuery(groupId: string) {
  const session = useSession();
  return useQuery({
    queryKey: groupKeys.detail(groupId),
    queryFn: () => getOfflineGroupDetail(groupId),
    enabled: session.status === "ready" && groupId.length > 0,
  });
}

export function useCreateGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGroup,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}

export function useJoinGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: joinGroup,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}

export function useGenerateInviteMutation() {
  return useMutation({ mutationFn: generateGroupInvite });
}

export function useAddIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  return useMutation({
    mutationFn: async ({
      shoppingListId,
      rawText,
      normalizedName,
      canonicalProductId,
      operationId,
      ...structured
    }: {
      shoppingListId: string;
      operationId: string;
      canonicalProductId?: string | null;
    } & AddShoppingIntentInput) => {
      const localIntent = createLocalIntent({
        operationId,
        shoppingListId,
        rawText,
        normalizedName,
        ...(canonicalProductId === undefined ? {} : { canonicalProductId }),
        ...structured,
      });
      return enqueueShoppingOperation({
        kind: "add_intent",
        operationId,
        groupId,
        shoppingListId,
        localIntent,
        createdAt: localIntent.created_at,
      });
    },
    onSuccess: (detail) =>
      completeLocalMutation(queryClient, groupId, detail, sync),
  });
}

export function useToggleIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  return useMutation({
    mutationFn: ({
      intentId,
      checked,
      operationId,
    }: {
      intentId: string;
      checked: boolean;
      operationId: string;
    }) =>
      enqueueShoppingOperation({
        kind: "set_checked",
        operationId,
        groupId,
        intentId,
        checked,
        createdAt: new Date().toISOString(),
      }),
    onSuccess: (detail) =>
      completeLocalMutation(queryClient, groupId, detail, sync),
  });
}

export function useEditIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  return useMutation({
    mutationFn: (variables: {
      intentId: string;
      rawText: string;
      normalizedName: string;
      operationId: string;
    }) =>
      enqueueShoppingOperation({
        kind: "edit_intent",
        groupId,
        ...variables,
        createdAt: new Date().toISOString(),
      }),
    onSuccess: (detail) =>
      completeLocalMutation(queryClient, groupId, detail, sync),
  });
}

export function useChangeIntentQuantityMutation(groupId: string) {
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  return useMutation({
    mutationFn: (variables: {
      intentId: string;
      direction: "increment" | "decrement";
      operationId: string;
    }) =>
      enqueueShoppingOperation({
        kind: "change_quantity",
        groupId,
        ...variables,
        createdAt: new Date().toISOString(),
      }),
    onSuccess: (detail) =>
      completeLocalMutation(queryClient, groupId, detail, sync),
  });
}

export function useDeleteIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  return useMutation({
    mutationFn: (variables: { intentId: string; operationId: string }) =>
      enqueueShoppingOperation({
        kind: "delete_intent",
        groupId,
        ...variables,
        createdAt: new Date().toISOString(),
      }),
    onSuccess: (detail) =>
      completeLocalMutation(queryClient, groupId, detail, sync),
  });
}

export function useUpdatePostalCodeMutation(groupId: string) {
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  return useMutation({
    mutationFn: ({
      shoppingListId,
      postalCode,
      operationId,
    }: {
      shoppingListId: string;
      postalCode: string;
      operationId: string;
    }) =>
      enqueueShoppingOperation({
        kind: "update_postal_code",
        operationId,
        groupId,
        shoppingListId,
        postalCode,
        createdAt: new Date().toISOString(),
      }),
    onSuccess: (detail) =>
      completeLocalMutation(queryClient, groupId, detail, sync),
  });
}

function completeLocalMutation(
  queryClient: ReturnType<typeof useQueryClient>,
  groupId: string,
  detail: Awaited<ReturnType<typeof enqueueShoppingOperation>>,
  sync: { refreshStatus: () => Promise<void>; syncNow: () => void },
): void {
  queryClient.setQueryData(groupKeys.detail(groupId), detail);
  void sync.refreshStatus();
  sync.syncNow();
}
