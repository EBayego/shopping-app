import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listSupermarketsForShoppingList,
  setSupermarketEnabledForShoppingList,
} from "../../repositories/supermarket-preferences-repository";

export const supermarketKeys = {
  root: ["supermarkets"] as const,
  list: (shoppingListId: string) =>
    ["supermarkets", "list", shoppingListId] as const,
};

export function useSupermarketsQuery(shoppingListId: string | null) {
  return useQuery({
    queryKey: supermarketKeys.list(shoppingListId ?? "missing"),
    queryFn: () => {
      if (shoppingListId === null) {
        throw new Error("A shopping list is required to load supermarkets");
      }
      return listSupermarketsForShoppingList(shoppingListId);
    },
    enabled: shoppingListId !== null,
  });
}

export function useSetSupermarketEnabledMutation(
  shoppingListId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      retailerId,
      enabled,
    }: {
      retailerId: string;
      enabled: boolean;
    }) => {
      if (shoppingListId === null) {
        throw new Error("A shopping list is required to update supermarkets");
      }
      return setSupermarketEnabledForShoppingList({
        shoppingListId,
        retailerId,
        enabled,
      });
    },
    onSuccess: async () => {
      if (shoppingListId === null) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: supermarketKeys.list(shoppingListId),
        }),
        queryClient.invalidateQueries({ queryKey: ["product-search"] }),
        queryClient.invalidateQueries({
          queryKey: ["basket-comparison", shoppingListId],
        }),
      ]);
    },
  });
}
