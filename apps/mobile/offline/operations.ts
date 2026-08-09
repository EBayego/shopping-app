import type { GroupDetail, ShoppingIntent } from "../features/groups/types";
import type { ShoppingOperation } from "./types";

export function applyOperationLocally(
  detail: GroupDetail,
  operation: ShoppingOperation,
): GroupDetail {
  switch (operation.kind) {
    case "add_intent":
      return detail.intents.some((item) => item.id === operation.localIntent.id)
        ? detail
        : { ...detail, intents: [...detail.intents, operation.localIntent] };
    case "edit_intent":
      return patchIntent(detail, operation.intentId, {
        raw_text: operation.rawText,
        normalized_name: operation.normalizedName,
        updated_at: operation.createdAt,
      });
    case "set_checked":
      return patchIntent(detail, operation.intentId, {
        checked: operation.checked,
        updated_at: operation.createdAt,
      });
    case "change_quantity": {
      const current = detail.intents.find(
        (item) => item.id === operation.intentId,
      )?.requested_quantity;
      const quantity = current ?? 1;
      return patchIntent(detail, operation.intentId, {
        requested_quantity:
          operation.direction === "increment"
            ? quantity + 1
            : Math.max(quantity - 1, 1),
        updated_at: operation.createdAt,
      });
    }
    case "delete_intent":
      return {
        ...detail,
        intents: detail.intents.filter(
          (item) => item.id !== operation.intentId,
        ),
      };
    case "update_postal_code":
      return {
        ...detail,
        lists: detail.lists.map((list) =>
          list.id === operation.shoppingListId
            ? {
                ...list,
                postal_code: operation.postalCode,
                updated_at: operation.createdAt,
              }
            : list,
        ),
      };
  }
}

function patchIntent(
  detail: GroupDetail,
  intentId: string,
  patch: Partial<ShoppingIntent>,
): GroupDetail {
  return {
    ...detail,
    intents: detail.intents.map((item) =>
      item.id === intentId ? { ...item, ...patch } : item,
    ),
  };
}

export function remapIntentId(
  operation: ShoppingOperation,
  localId: string,
  serverId: string,
): ShoppingOperation {
  if (operation.kind === "add_intent") return operation;
  if ("intentId" in operation && operation.intentId === localId) {
    return { ...operation, intentId: serverId };
  }
  return operation;
}
