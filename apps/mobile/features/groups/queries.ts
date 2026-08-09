import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../auth/session-provider";
import {
  addShoppingIntent,
  changeShoppingIntentQuantity,
  createGroup,
  deleteShoppingIntent,
  editShoppingIntent,
  generateGroupInvite,
  getGroupDetail,
  joinGroup,
  listGroups,
  setShoppingIntentChecked,
  updateShoppingListPostalCode,
} from "../../repositories/groups-repository";
import type { GroupDetail, ShoppingIntent } from "./types";

export const groupKeys = {
  all: ["groups"] as const,
  detail: (groupId: string) => ["groups", groupId] as const,
};

export function useGroupsQuery() {
  const session = useSession();
  return useQuery({
    queryKey: groupKeys.all,
    queryFn: listGroups,
    enabled: session.status === "ready",
  });
}

export function useGroupDetailQuery(groupId: string) {
  const session = useSession();
  return useQuery({
    queryKey: groupKeys.detail(groupId),
    queryFn: () => getGroupDetail(groupId),
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
  return useMutation({
    mutationFn: ({
      shoppingListId,
      rawText,
      normalizedName,
      operationId,
    }: {
      shoppingListId: string;
      rawText: string;
      normalizedName: string;
      operationId: string;
    }) =>
      addShoppingIntent(
        shoppingListId,
        { rawText, normalizedName },
        operationId,
      ),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: groupKeys.detail(groupId) });
      const previous = queryClient.getQueryData<GroupDetail>(
        groupKeys.detail(groupId),
      );
      const now = new Date().toISOString();
      const optimistic: ShoppingIntent = {
        id: `optimistic:${variables.operationId}`,
        shopping_list_id: variables.shoppingListId,
        raw_text: variables.rawText,
        normalized_name: variables.normalizedName,
        requested_quantity: 1,
        requested_unit: null,
        package_count: null,
        package_size: null,
        package_unit: null,
        total_amount: null,
        brand_preference: null,
        variant: null,
        canonical_product_id: null,
        checked: false,
        created_by: null,
        created_at: now,
        updated_at: now,
      };
      if (previous) {
        queryClient.setQueryData<GroupDetail>(groupKeys.detail(groupId), {
          ...previous,
          intents: [...previous.intents, optimistic],
        });
      }
      return previous;
    },
    onError: (_error, _variables, previous) => {
      if (previous)
        queryClient.setQueryData(groupKeys.detail(groupId), previous);
    },
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useToggleIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      intentId,
      checked,
      operationId,
    }: {
      intentId: string;
      checked: boolean;
      operationId: string;
    }) => setShoppingIntentChecked(intentId, checked, operationId),
    onMutate: (variables) =>
      optimisticallyUpdateIntent(queryClient, groupId, variables.intentId, {
        checked: variables.checked,
      }),
    onError: (_error, _variables, previous) =>
      restoreGroupDetail(queryClient, groupId, previous),
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useEditIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      intentId: string;
      rawText: string;
      normalizedName: string;
      operationId: string;
    }) =>
      editShoppingIntent(
        variables.intentId,
        {
          rawText: variables.rawText,
          normalizedName: variables.normalizedName,
        },
        variables.operationId,
      ),
    onMutate: (variables) =>
      optimisticallyUpdateIntent(queryClient, groupId, variables.intentId, {
        raw_text: variables.rawText,
        normalized_name: variables.normalizedName,
      }),
    onError: (_error, _variables, previous) =>
      restoreGroupDetail(queryClient, groupId, previous),
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useChangeIntentQuantityMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      intentId: string;
      direction: "increment" | "decrement";
      operationId: string;
    }) =>
      changeShoppingIntentQuantity(
        variables.intentId,
        variables.direction,
        variables.operationId,
      ),
    onMutate: (variables) => {
      const detail = queryClient.getQueryData<GroupDetail>(
        groupKeys.detail(groupId),
      );
      const intent = detail?.intents.find(
        (candidate) => candidate.id === variables.intentId,
      );
      const current = intent?.requested_quantity ?? 1;
      const requestedQuantity =
        variables.direction === "increment"
          ? current + 1
          : Math.max(current - 1, 1);
      return optimisticallyUpdateIntent(
        queryClient,
        groupId,
        variables.intentId,
        { requested_quantity: requestedQuantity },
      );
    },
    onError: (_error, _variables, previous) =>
      restoreGroupDetail(queryClient, groupId, previous),
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useDeleteIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { intentId: string; operationId: string }) =>
      deleteShoppingIntent(variables.intentId, variables.operationId),
    onMutate: (variables) => {
      const previous = queryClient.getQueryData<GroupDetail>(
        groupKeys.detail(groupId),
      );
      if (previous) {
        queryClient.setQueryData<GroupDetail>(groupKeys.detail(groupId), {
          ...previous,
          intents: previous.intents.filter(
            (intent) => intent.id !== variables.intentId,
          ),
        });
      }
      return previous;
    },
    onError: (_error, _variables, previous) =>
      restoreGroupDetail(queryClient, groupId, previous),
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useUpdatePostalCodeMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shoppingListId,
      postalCode,
      operationId,
    }: {
      shoppingListId: string;
      postalCode: string;
      operationId: string;
    }) => updateShoppingListPostalCode(shoppingListId, postalCode, operationId),
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

function optimisticallyUpdateIntent(
  queryClient: ReturnType<typeof useQueryClient>,
  groupId: string,
  intentId: string,
  patch: Partial<ShoppingIntent>,
): GroupDetail | undefined {
  const previous = queryClient.getQueryData<GroupDetail>(
    groupKeys.detail(groupId),
  );
  if (previous) {
    queryClient.setQueryData<GroupDetail>(groupKeys.detail(groupId), {
      ...previous,
      intents: previous.intents.map((intent) =>
        intent.id === intentId ? { ...intent, ...patch } : intent,
      ),
    });
  }
  return previous;
}

function restoreGroupDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  groupId: string,
  previous: GroupDetail | undefined,
): void {
  if (previous) queryClient.setQueryData(groupKeys.detail(groupId), previous);
}
