import { useQuery } from "@tanstack/react-query";

import { getBasketComparisons } from "../../repositories/basket-comparison-repository";

export const comparisonKeys = {
  list: (shoppingListId: string) =>
    ["basket-comparison", shoppingListId] as const,
};

export function useBasketComparisonQuery(shoppingListId: string) {
  return useQuery({
    queryKey: comparisonKeys.list(shoppingListId),
    queryFn: () => getBasketComparisons(shoppingListId),
    enabled: shoppingListId.length > 0,
  });
}
