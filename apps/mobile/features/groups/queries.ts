import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../auth/session-provider";
import {
  addShoppingIntent,
  createGroup,
  generateGroupInvite,
  getGroupDetail,
  joinGroup,
  listGroups,
  setShoppingIntentChecked,
  updateShoppingListPostalCode,
} from "../../repositories/groups-repository";

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
    }: {
      shoppingListId: string;
      rawText: string;
      normalizedName: string;
    }) => addShoppingIntent(shoppingListId, { rawText, normalizedName }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useToggleIntentMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      intentId,
      checked,
    }: {
      intentId: string;
      checked: boolean;
    }) => setShoppingIntentChecked(intentId, checked),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}

export function useUpdatePostalCodeMutation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shoppingListId,
      postalCode,
    }: {
      shoppingListId: string;
      postalCode: string;
    }) => updateShoppingListPostalCode(shoppingListId, postalCode),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}
