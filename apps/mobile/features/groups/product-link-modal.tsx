import { Modal, Text } from "react-native";
import { Screen } from "../../components/screen";
import { AppButton } from "../../components/app-button";
import { ProductSearchPanel } from "../search/product-search-panel";
import type { ProductSearchOffer, ProductSearchResult } from "../search/types";
import { useTheme } from "../theme/theme-context";
import { useOfflineSync } from "../../offline/offline-sync-provider";
import { useLinkProductMutation } from "./queries";
import { productLinkInput, readProductLink } from "./product-links";
import type { ShoppingIntent } from "./types";
import { createOperationId } from "../../lib/operation-id";
import { getErrorMessage } from "../../lib/errors";

export function ProductLinkModal({
  intent,
  groupId,
  onClose,
}: {
  intent: ShoppingIntent;
  groupId: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const sync = useOfflineSync();
  const link = useLinkProductMutation(groupId);
  const selected = readProductLink(intent.product_link);
  const choose = (result: ProductSearchResult, offer: ProductSearchOffer) => {
    const product = result.retailerProducts.find(
      (item) => item.id === offer.retailerProduct.id,
    );
    link.mutate(
      {
        intentId: intent.id,
        operationId: createOperationId(),
        expectedInput: productLinkInput(intent),
        productId: offer.retailerProduct.id,
        marketId: offer.market.id,
        snapshot: {
          offerId: "pending",
          productId: offer.retailerProduct.id,
          marketId: offer.market.id,
          productName: offer.retailerProduct.name,
          retailerId: offer.retailer.id,
          retailerCode: offer.retailer.code,
          retailerName: offer.retailer.name,
          imageUrl: offer.retailerProduct.imageUrl,
          packageSize: product?.packageSize ?? null,
          packageUnit: product?.packageUnit ?? null,
          packageCount: product?.packageCount ?? null,
          price:
            offer.requiresMembership ||
            ["multi_buy", "membership", "other"].includes(
              offer.promotion?.type ?? "",
            )
              ? offer.normalPrice
              : offer.price,
          observedAt: offer.observedAt,
          source: "manual",
          approximate: false,
        },
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Screen>
        <Text style={{ color: colors.text, fontSize: 23, fontWeight: "700" }}>
          {intent.raw_text}
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          Elige un producto de tus supermercados. El nombre y la cantidad de tu
          lista se conservan.
        </Text>
        {!sync.isOnline ? (
          <Text style={{ color: colors.muted }}>
            Sin conexión. Puedes quitar el enlace o elegir entre resultados
            guardados; se validarán al sincronizar.
          </Text>
        ) : null}
        {selected ? (
          <>
            <Text style={{ color: colors.text }}>
              Enlazado: {selected.productName} · {selected.retailerName}
            </Text>
            <AppButton
              tone="secondary"
              disabled={link.isPending}
              onPress={() =>
                link.mutate(
                  {
                    intentId: intent.id,
                    operationId: createOperationId(),
                    expectedInput: productLinkInput(intent),
                    productId: null,
                    marketId: null,
                    snapshot: null,
                  },
                  { onSuccess: onClose },
                )
              }
            >
              Quitar enlace
            </AppButton>
          </>
        ) : null}
        <ProductSearchPanel
          mode="link"
          initialQuery={[
            intent.normalized_name,
            intent.variant,
            intent.brand_preference,
          ]
            .filter(Boolean)
            .join(" ")}
          adding={link.isPending}
          shoppingListId={intent.shopping_list_id}
          onClose={onClose}
          onAddFreeItem={() => undefined}
          onSelectProduct={() => undefined}
          onSelectOffer={choose}
        />
        {link.error ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {getErrorMessage(link.error)}
          </Text>
        ) : null}
      </Screen>
    </Modal>
  );
}
