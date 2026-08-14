import { parseShoppingIntents } from "@shopping-app/voice-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  textToIntentInput,
  voiceDraftToIntentInput,
} from "../features/voice/voice-intent-input";
import { getSupabaseClient } from "../services/supabase";
import { getBasketComparisons } from "./basket-comparison-repository";
import { addShoppingIntent } from "./groups-repository";
import { listSupermarketsForShoppingList } from "./supermarket-preferences-repository";

vi.mock("../services/supabase", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("./supermarket-preferences-repository", () => ({
  listSupermarketsForShoppingList: vi.fn(),
}));

const MILK_CONCEPT_ID = "10000000-0000-4000-8000-000000000001";
const INTENT_ID = "91000000-0000-4000-8000-000000000001";

describe("flujo integrado de leche 2 l", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSupermarketsForShoppingList).mockResolvedValue([
      {
        retailerId: "retailer-dia",
        code: "DIA",
        name: "DIA",
        enabled: true,
      },
      {
        retailerId: "retailer-mercadona",
        code: "MERCADONA",
        name: "Mercadona",
        enabled: true,
      },
    ]);
  });

  it.each([
    {
      source: "voz",
      input: () => {
        const draft = parseShoppingIntents("dos litros de leche")[0];
        if (!draft) throw new Error("El parser no devolvió leche");
        return voiceDraftToIntentInput(draft);
      },
    },
    {
      source: "texto",
      input: () => textToIntentInput("leche 2L"),
    },
  ])(
    "mantiene cantidad, concepto y elección comercial desde $source",
    async ({ input }) => {
      const structured = input();
      const comparisonPayload = buildComparisonPayload(structured);
      const rpc = vi.fn((procedure: string) => {
        if (procedure === "add_shopping_product_operation") {
          return Promise.resolve({
            data: {
              id: INTENT_ID,
              product_concept_id: MILK_CONCEPT_ID,
              requested_quantity: structured.requestedQuantity,
              requested_unit: structured.requestedUnit,
              total_amount: structured.totalAmount,
            },
            error: null,
          });
        }
        if (procedure === "get_basket_comparison_inputs") {
          return Promise.resolve({ data: comparisonPayload, error: null });
        }
        return Promise.reject(new Error(`RPC inesperada: ${procedure}`));
      });
      vi.mocked(getSupabaseClient).mockReturnValue({
        rpc,
      } as unknown as ReturnType<typeof getSupabaseClient>);

      const persisted = await addShoppingIntent(
        "list-2l",
        structured,
        `operation-${structured.rawText}`,
      );
      expect(structured).toMatchObject({
        normalizedName: "leche",
        requestedQuantity: 2,
        requestedUnit: "l",
        totalAmount: 2,
      });
      expect(persisted).toMatchObject({
        product_concept_id: MILK_CONCEPT_ID,
        requested_quantity: 2,
        requested_unit: "l",
        total_amount: 2,
      });
      expect(rpc).toHaveBeenCalledWith("add_shopping_product_operation", {
        operation_id: `operation-${structured.rawText}`,
        shopping_list_id: "list-2l",
        raw_text: structured.rawText,
        normalized_name: "leche",
        requested_quantity: 2,
        requested_unit: "l",
        total_amount: 2,
      });

      const comparisons = await getBasketComparisons("list-2l");
      const dia = comparisons.find((basket) => basket.retailer === "DIA");
      const mercadona = comparisons.find(
        (basket) => basket.retailer === "MERCADONA",
      );

      expect(dia?.lines[0]).toMatchObject({
        intentId: INTENT_ID,
        productId: "dia-milk-pack-2l",
        commercialUnits: 1,
        suppliedAmount: 2,
        suppliedUnit: "l",
        estimatedLineTotal: 1.8,
      });
      expect(mercadona?.lines[0]).toMatchObject({
        intentId: INTENT_ID,
        productId: "mercadona-milk-1l",
        commercialUnits: 2,
        suppliedAmount: 2,
        suppliedUnit: "l",
        estimatedLineTotal: 1.78,
      });
    },
  );
});

function buildComparisonPayload(input: {
  requestedQuantity?: number;
  requestedUnit?: string;
  totalAmount?: number;
}) {
  const common = {
    intentId: INTENT_ID,
    classificationConfidence: "HIGH",
    classificationAccepted: true,
    standard: true,
    variableWeight: false,
    requiresMembership: false,
    available: true,
    freshness: "FRESH",
  } as const;
  return {
    retailers: ["DIA", "MERCADONA"],
    intents: [
      {
        id: INTENT_ID,
        name: "leche",
        productConceptId: MILK_CONCEPT_ID,
        requestedQuantity: input.requestedQuantity,
        requestedUnit: input.requestedUnit,
        totalAmount: input.totalAmount,
        packageUnit: "l",
        defaultAmount: 1,
        defaultUnit: "l",
        selectionPolicy: "CHEAPEST_COVERING",
      },
    ],
    candidates: [
      {
        ...common,
        retailer: "DIA",
        productId: "dia-milk-1l",
        productName: "Leche DIA 1 l",
        packageSize: 1,
        packageUnit: "l",
        normalPrice: 0.95,
      },
      {
        ...common,
        retailer: "DIA",
        productId: "dia-milk-pack-2l",
        productName: "Leche DIA pack 2 x 1 l",
        packageSize: 1,
        packageUnit: "l",
        packageCount: 2,
        totalAmount: 2,
        normalPrice: 1.8,
      },
      {
        ...common,
        retailer: "MERCADONA",
        productId: "mercadona-milk-1l",
        productName: "Leche Hacendado 1 l",
        packageSize: 1,
        packageUnit: "l",
        normalPrice: 0.89,
      },
    ],
  };
}
