import type { GroupDetail, ShoppingIntent } from "../features/groups/types";
import type { ShoppingOperation } from "./types";
import { productLinkInput } from "../features/groups/product-links";

export function applyOperationLocally(
  detail: GroupDetail,
  operation: ShoppingOperation,
): GroupDetail {
  switch (operation.kind) {
    case "link_product": {
      const intent = detail.intents.find(
        (item) => item.id === operation.intentId,
      );
      if (
        !intent ||
        JSON.stringify(productLinkInput(intent)) !==
          JSON.stringify(operation.expectedInput)
      )
        return detail;
      const offerId =
        operation.snapshot &&
        typeof operation.snapshot === "object" &&
        !Array.isArray(operation.snapshot) &&
        typeof operation.snapshot.offerId === "string"
          ? operation.snapshot.offerId
          : null;
      return patchIntent(detail, operation.intentId, {
        linked_offer_id: offerId,
        product_link: operation.snapshot,
        updated_at: operation.createdAt,
      });
    }
    case "add_intent":
      return detail.intents.some((item) => item.id === operation.localIntent.id)
        ? detail
        : { ...detail, intents: [...detail.intents, operation.localIntent] };
    case "edit_intent":
      return patchIntent(detail, operation.intentId, {
        raw_text: operation.input.rawText,
        normalized_name: operation.input.normalizedName,
        requested_quantity: operation.input.requestedQuantity,
        requested_unit: operation.input.requestedUnit,
        package_count: operation.input.packageCount,
        package_size: operation.input.packageSize,
        package_unit: operation.input.packageUnit,
        package_type: operation.input.packageType ?? null,
        total_amount: operation.input.totalAmount,
        brand_preference: operation.input.brandPreference,
        variant: operation.input.variant,
        updated_at: operation.createdAt,
      });
    case "set_checked":
      return patchIntent(detail, operation.intentId, {
        checked: operation.checked,
        updated_at: operation.createdAt,
      });
    case "change_quantity": {
      const intent = detail.intents.find(
        (item) => item.id === operation.intentId,
      );
      const quantity = intent?.package_count ?? intent?.requested_quantity ?? 1;
      const nextQuantity =
        operation.direction === "increment"
          ? quantity + 1
          : Math.max(quantity - 1, 1);
      const packaged = intent !== undefined && intent.package_count !== null;
      return patchIntent(detail, operation.intentId, {
        requested_quantity: nextQuantity,
        ...(packaged
          ? {
              package_count: nextQuantity,
              ...(intent.package_size === null
                ? {}
                : { total_amount: nextQuantity * intent.package_size }),
            }
          : {}),
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
        intents: detail.intents.map((intent) =>
          intent.shopping_list_id === operation.shoppingListId
            ? { ...intent, linked_offer_id: null, product_link: null }
            : intent,
        ),
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
    intents: detail.intents.map((item) => {
      if (item.id !== intentId) return item;
      const updated = { ...item, ...patch };
      return JSON.stringify(productLinkInput(item)) ===
        JSON.stringify(productLinkInput(updated))
        ? updated
        : { ...updated, linked_offer_id: null, product_link: null };
    }),
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
