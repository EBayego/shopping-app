import { describe, expect, it } from "vitest";
import { applyOperationLocally, remapIntentId } from "./operations";
import type { GroupDetail, ShoppingIntent } from "../features/groups/types";
import { productLinkInput } from "../features/groups/product-links";
import type { ShoppingOperation } from "./types";

const intent: ShoppingIntent = {
  id: "local:add",
  shopping_list_id: "list",
  raw_text: "Mi leche",
  normalized_name: "leche",
  requested_quantity: 1,
  requested_unit: "l",
  package_count: null,
  package_size: null,
  package_unit: null,
  package_type: null,
  total_amount: null,
  brand_preference: null,
  variant: null,
  product_concept_id: null,
  concept_resolution_method: null,
  concept_resolution_score: null,
  checked: false,
  created_by: null,
  created_at: "now",
  updated_at: "now",
};
const detail: GroupDetail = {
  group: {
    id: "group",
    name: "Home",
    created_by: null,
    created_at: "now",
    updated_at: "now",
  },
  lists: [],
  members: [],
  intents: [intent],
};
const operation: Extract<ShoppingOperation, { kind: "link_product" }> = {
  kind: "link_product",
  operationId: "op",
  groupId: "group",
  createdAt: "later",
  intentId: intent.id,
  expectedInput: productLinkInput(intent),
  productId: "product",
  marketId: "market",
  snapshot: { offerId: "offer", source: "manual" },
};
describe("offline product links", () => {
  it("adds a link without overwriting user text, quantities or concepts", () => {
    const linked = applyOperationLocally(detail, operation).intents[0];
    expect(linked).toMatchObject({
      raw_text: "Mi leche",
      requested_quantity: 1,
      product_concept_id: null,
      linked_offer_id: "offer",
      product_link: operation.snapshot,
    });
  });
  it("keeps the link when marking an item bought, and invalidates it when quantity changes", () => {
    const linked = applyOperationLocally(detail, operation);
    const base = {
      operationId: "next",
      groupId: "group",
      createdAt: "next",
      intentId: intent.id,
    };
    expect(
      applyOperationLocally(linked, {
        ...base,
        kind: "set_checked",
        checked: true,
      }).intents[0]?.product_link,
    ).toEqual(operation.snapshot);
    expect(
      applyOperationLocally(linked, {
        ...base,
        kind: "change_quantity",
        direction: "increment",
      }).intents[0]?.product_link,
    ).toBeNull();
  });
  it("does not project a stale selection over changed input", () => {
    const changed = {
      ...detail,
      intents: [{ ...intent, normalized_name: "pan" }],
    };
    expect(applyOperationLocally(changed, operation)).toBe(changed);
  });
  it("remaps queued links after the pending add receives its server id", () => {
    expect(remapIntentId(operation, intent.id, "server-id")).toMatchObject({
      intentId: "server-id",
    });
  });
  it("can queue unlinking while offline", () => {
    const linked = applyOperationLocally(detail, operation);
    expect(
      applyOperationLocally(linked, {
        ...operation,
        snapshot: null,
        productId: null,
        marketId: null,
      }).intents[0]?.product_link,
    ).toBeNull();
  });
});
