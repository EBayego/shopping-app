import type { BasketComparisonLine } from "@shopping-app/domain";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import { useBasketComparisonQuery } from "../../features/comparison/queries";
import { getErrorMessage } from "../../lib/errors";
import { colors, spacing } from "../../lib/theme";

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

export default function BasketComparisonScreen() {
  const params = useLocalSearchParams<{ listId: string | string[] }>();
  const listId = Array.isArray(params.listId)
    ? (params.listId[0] ?? "")
    : (params.listId ?? "");
  const comparison = useBasketComparisonQuery(listId);

  if (comparison.isLoading) {
    return (
      <Screen scroll={false}>
        <ScreenState loading title="Comparando supermercados" />
      </Screen>
    );
  }
  if (comparison.isError) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="No se pudo comparar la cesta"
          message={getErrorMessage(comparison.error)}
          retry={() => void comparison.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <View style={styles.intro}>
        <Text style={styles.title}>Cesta completa por supermercado</Text>
        <Text style={styles.muted}>
          Orden: mayor cobertura, menos precios obsoletos y, después, menor
          importe. No mezclamos tiendas.
        </Text>
      </View>
      {(comparison.data ?? []).map((basket, index) => (
        <View
          key={basket.retailer}
          style={[styles.card, index === 0 && styles.bestCard]}
        >
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.retailer}>{basket.retailer}</Text>
              <Text style={styles.coverage}>
                {basket.matchedItems}/{basket.totalItems} encontrados ·{" "}
                {basket.coveragePercentage}%
              </Text>
            </View>
            <View style={styles.totalBox}>
              <Text style={styles.total}>
                {basket.estimatedTotalIsApproximate ? "≈ " : ""}
                {euro.format(basket.estimatedTotal)}
              </Text>
              {basket.estimatedTotalIsApproximate ? (
                <Text style={styles.subtotal}>estimado por peso variable</Text>
              ) : null}
              {basket.matchedItems < basket.totalItems ? (
                <Text style={styles.subtotal}>subtotal disponible</Text>
              ) : null}
            </View>
          </View>
          {basket.staleItems > 0 ? (
            <Text style={styles.warning}>
              ⚠ {basket.staleItems} precio(s) desactualizado(s); VERY_STALE
              reduce el ranking.
            </Text>
          ) : null}
          {basket.lines.map((line) => (
            <ComparisonLine key={line.intentId} line={line} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

function ComparisonLine({ line }: { line: BasketComparisonLine }) {
  if (line.status !== "MATCHED") {
    const reason =
      line.status === "UNAVAILABLE"
        ? "no disponible"
        : line.status === "INCOMPATIBLE_UNITS"
          ? "unidades incompatibles"
          : "sin match fiable";
    return (
      <View style={styles.line}>
        <Text style={styles.lineName}>{line.requestedName}</Text>
        <Text style={styles.missing}>Falta · {reason}</Text>
      </View>
    );
  }
  return (
    <View style={styles.line}>
      <View style={styles.lineMain}>
        <Text style={styles.lineName}>{line.requestedName}</Text>
        <Text style={styles.product}>
          {line.productName} · {line.commercialUnits} envase(s)
        </Text>
        {line.normalizedPrice !== undefined ? (
          <Text style={styles.product}>
            {euro.format(line.normalizedPrice)}/{line.normalizedUnit}
          </Text>
        ) : null}
        {line.promoPrice !== undefined ? (
          <Text style={styles.promo}>
            {line.membershipPriceNotApplied
              ? `Precio club ${euro.format(line.promoPrice)} no aplicado`
              : `Promo aplicada ${euro.format(line.promoPrice)}`}
          </Text>
        ) : null}
        {line.freshness === "VERY_STALE" ? (
          <Text style={styles.warning}>Precio muy desactualizado</Text>
        ) : null}
      </View>
      <Text style={styles.linePrice}>
        {line.approximate ? "≈ " : ""}
        {euro.format(line.estimatedLineTotal ?? 0)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.sm },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  bestCard: { borderColor: colors.primary, borderWidth: 2 },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  retailer: { color: colors.text, fontSize: 20, fontWeight: "800" },
  coverage: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  totalBox: { alignItems: "flex-end" },
  total: { color: colors.text, fontSize: 20, fontWeight: "800" },
  subtotal: { color: colors.muted, fontSize: 11 },
  warning: { color: "#9A6700", fontSize: 12, lineHeight: 17 },
  line: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  lineMain: { flex: 1 },
  lineName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  product: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  linePrice: { color: colors.text, fontSize: 15, fontWeight: "700" },
  missing: { color: colors.danger, fontSize: 12 },
  promo: { color: colors.primary, fontSize: 12, fontWeight: "700" },
});
