import { useQuery } from "@tanstack/react-query";

import { searchProductsForList } from "../../repositories/product-search-repository";

export const productSearchKeys = {
  list: (shoppingListId: string, query: string) =>
    ["product-search", shoppingListId, query] as const,
};

export function useProductSearchQuery(shoppingListId: string, query: string) {
  return useQuery({
    queryKey: productSearchKeys.list(shoppingListId, query),
    queryFn: () => searchProductsForList(shoppingListId, query),
    enabled: query.length >= 2,
    staleTime: 60_000,
    retry: 1,
  });
}
