import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppButton } from "../../components/app-button";
import { AppInput } from "../../components/app-input";
import { getErrorMessage } from "../../lib/errors";
import { colors, spacing } from "../../lib/theme";
import {
  formatObservedAge,
  formatPrice,
  formatPricePerUnit,
  freshnessLabel,
  resultBrand,
  resultFormat,
  resultName,
} from "./formatting";
import { useProductSearchQuery } from "./queries";
import type { ProductSearchOffer, ProductSearchResult } from "./types";

interface ProductSearchPanelProps {
  shoppingListId: string;
  adding: boolean;
  onAddFreeItem: (text: string) => void;
  onClose: () => void;
  onRefreshOffers?: (result: ProductSearchResult) => void;
  onSelectProduct: (result: ProductSearchResult) => void;
}

export function ProductSearchPanel({
  shoppingListId,
  adding,
  onAddFreeItem,
  onClose,
  onRefreshOffers,
  onSelectProduct,
}: ProductSearchPanelProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 350);
  const search = useProductSearchQuery(shoppingListId, debouncedQuery);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeading}>
        <Text style={styles.title}>Añadir producto</Text>
        <Pressable accessibilityRole="button" onPress={onClose}>
          <Text style={styles.action}>Cerrar</Text>
        </Pressable>
      </View>
      <AppInput
        autoFocus
        label="Buscar producto"
        onChangeText={setQuery}
        placeholder="Leche semidesnatada"
        value={query}
      />

      {query.trim().length > 0 ? (
        <AppButton
          disabled={adding}
          tone="secondary"
          onPress={() => onAddFreeItem(query.trim())}
        >
          Añadir “{query.trim()}” como item libre
        </AppButton>
      ) : null}

      {debouncedQuery.length < 2 ? (
        <Text style={styles.hint}>Escribe al menos dos caracteres.</Text>
      ) : search.isFetching ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.hint}>Buscando en el catálogo…</Text>
        </View>
      ) : search.isError ? (
        <View style={styles.stateBox}>
          <Text style={styles.error}>No se pudo completar la búsqueda.</Text>
          <Text style={styles.hint}>{getErrorMessage(search.error)}</Text>
          <AppButton tone="secondary" onPress={() => void search.refetch()}>
            Reintentar búsqueda
          </AppButton>
        </View>
      ) : search.data?.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.title}>Sin resultados de catálogo</Text>
          <Text style={styles.hint}>
            Puedes añadir el texto como item libre y completarlo después.
          </Text>
        </View>
      ) : (
        <View style={styles.results}>
          {search.data?.map((result, index) => (
            <ProductResultCard
              key={
                result.canonicalProduct?.id ??
                result.retailerProducts[0]?.id ??
                index
              }
              adding={adding}
              onRefreshOffers={onRefreshOffers}
              onSelect={onSelectProduct}
              result={result}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ProductResultCard({
  result,
  adding,
  onRefreshOffers,
  onSelect,
}: {
  result: ProductSearchResult;
  adding: boolean;
  onRefreshOffers?: ((result: ProductSearchResult) => void) | undefined;
  onSelect: (result: ProductSearchResult) => void;
}) {
  const imageUrl = result.retailerProducts.find(
    (product) => product.imageUrl,
  )?.imageUrl;
  const brand = resultBrand(result);
  const format = resultFormat(result);
  const hasOldOffer = result.offers.some(
    (offer) => offer.freshness !== "FRESH",
  );

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`Añadir ${resultName(result)}`}
        accessibilityRole="button"
        disabled={adding}
        onPress={() => onSelect(result)}
        style={styles.productHeader}
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Text style={styles.imagePlaceholderText}>Sin imagen</Text>
          </View>
        )}
        <View style={styles.productCopy}>
          <Text style={styles.productName}>{resultName(result)}</Text>
          {brand ? <Text style={styles.meta}>{brand}</Text> : null}
          {format ? <Text style={styles.meta}>{format}</Text> : null}
          <Text style={styles.selectText}>Seleccionar producto</Text>
        </View>
      </Pressable>

      {result.offers.length === 0 ? (
        <Text style={styles.hint}>
          Sin ofertas disponibles para este código postal.
        </Text>
      ) : (
        <View style={styles.offers}>
          {result.offers.map((offer) => (
            <OfferRow
              key={`${offer.market.id}:${offer.retailerProduct.id}`}
              offer={offer}
            />
          ))}
        </View>
      )}

      {hasOldOffer && onRefreshOffers ? (
        <Pressable onPress={() => onRefreshOffers(result)}>
          <Text style={styles.action}>Solicitar actualización</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function OfferRow({ offer }: { offer: ProductSearchOffer }) {
  const unitPrice = formatPricePerUnit(offer.pricePerUnit, offer.referenceUnit);
  const stale = freshnessLabel(offer.freshness);
  return (
    <View style={styles.offer}>
      <View style={styles.offerHeading}>
        <Text style={styles.retailer}>{offer.retailer.name}</Text>
        <Text style={styles.price}>{formatPrice(offer.price)}</Text>
      </View>
      {unitPrice ? <Text style={styles.unitPrice}>{unitPrice}</Text> : null}
      {offer.promotion ? (
        <Text style={styles.promotion}>
          {offer.promotion.text ?? "Promoción disponible"}
          {offer.requiresMembership ? " · Requiere membresía" : ""}
        </Text>
      ) : offer.requiresMembership ? (
        <Text style={styles.promotion}>Requiere membresía</Text>
      ) : null}
      <Text style={offer.availability ? styles.available : styles.unavailable}>
        {offer.availability ? "Disponible" : "No disponible"}
      </Text>
      <View style={styles.freshnessRow}>
        <Text style={styles.age}>{formatObservedAge(offer.observedAt)}</Text>
        {stale ? <Text style={styles.stale}>{stale}</Text> : null}
      </View>
    </View>
  );
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, marginVertical: spacing.sm },
  panelHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  action: { color: colors.primary, fontWeight: "700" },
  hint: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: "700" },
  statusRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  stateBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  results: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.md,
    gap: spacing.md,
  },
  productHeader: { flexDirection: "row", gap: spacing.md },
  productCopy: { flex: 1, gap: spacing.xs },
  productName: { color: colors.text, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.muted },
  selectText: {
    color: colors.primary,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  image: { width: 72, height: 72, borderRadius: 10 },
  imagePlaceholder: {
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePlaceholderText: { color: colors.muted, fontSize: 11 },
  offers: { gap: spacing.sm },
  offer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  offerHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  retailer: { color: colors.text, fontWeight: "700" },
  price: { color: colors.text, fontSize: 18, fontWeight: "800" },
  unitPrice: { color: colors.text, fontWeight: "600" },
  promotion: { color: colors.primary, fontWeight: "600" },
  available: { color: colors.primary },
  unavailable: { color: colors.danger },
  freshnessRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  age: { color: colors.muted, fontSize: 12 },
  stale: { color: colors.muted, fontSize: 12, fontWeight: "600" },
});
