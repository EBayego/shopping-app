import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemedStyles, useTheme } from "../theme/theme-context";
import type { ThemeColors } from "../../lib/theme";
import {
  formatObservedAge,
  formatPrice,
  freshnessLabel,
} from "../search/formatting";
import { formatShoppingIntent } from "./intent-formatting";
import { productIcon } from "./product-icons";
import { readProductLink } from "./product-links";
import type { ShoppingIntent } from "./types";

export function ShoppingItemCard({
  intent,
  onEdit,
  onDelete,
  onLink,
  onQuantity,
  retailerEnabled = true,
}: {
  intent: ShoppingIntent;
  onEdit: () => void;
  onDelete: () => void;
  onLink: () => void;
  onQuantity: (direction: "increment" | "decrement") => void;
  retailerEnabled?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const display = formatShoppingIntent(intent);
  const link = readProductLink(intent.product_link);
  const ageHours = link
    ? (Date.now() - new Date(link.observedAt).getTime()) / 3_600_000
    : 0;
  const stale = freshnessLabel(
    ageHours >= 24 ? "VERY_STALE" : ageHours >= 6 ? "STALE" : "FRESH",
  );
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text accessible={false} style={styles.illustration}>
          {productIcon(intent.normalized_name)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Enlazar ${display.title}`}
          onPress={onLink}
          style={styles.action}
        >
          <Ionicons color={colors.primary} name="link-outline" size={20} />
        </Pressable>
      </View>
      <Text style={styles.title}>{display.title}</Text>
      <Text style={styles.quantity}>
        {display.quantity}
        {display.unit ? ` ${display.unit}` : ""}
      </Text>
      <View style={styles.quantityRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reducir cantidad de ${display.title}`}
          onPress={() => onQuantity("decrement")}
          style={styles.quantityButton}
        >
          <Text style={styles.quantitySymbol}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Aumentar cantidad de ${display.title}`}
          onPress={() => onQuantity("increment")}
          style={styles.quantityButton}
        >
          <Text style={styles.quantitySymbol}>+</Text>
        </Pressable>
      </View>
      {link ? (
        <View style={styles.linkInfo}>
          <Text style={styles.linkName}>{link.productName}</Text>
          <Text style={styles.price}>
            {link.retailerName} · {formatPrice(link.price)}
          </Text>
          {link.packageSize && link.packageUnit ? (
            <Text style={styles.meta}>
              {link.packageCount && link.packageCount > 1
                ? `${link.packageCount} × `
                : ""}
              {link.packageSize} {link.packageUnit}
            </Text>
          ) : null}
          {link.referenceAmount && link.referenceUnit ? (
            <Text style={styles.meta}>
              Comparado para {link.referenceAmount} {link.referenceUnit}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {link.source === "automatic"
              ? "Enlace automático"
              : "Elegido por ti"}
          </Text>
          <Text style={styles.meta}>{formatObservedAge(link.observedAt)}</Text>
          {stale || link.approximate || !retailerEnabled ? (
            <Text style={styles.meta}>
              {[
                stale,
                link.approximate ? "Precio orientativo" : null,
                !retailerEnabled ? "Supermercado desactivado" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Editar ${display.title}`}
          onPress={onEdit}
          style={styles.action}
        >
          <Ionicons color={colors.text} name="create-outline" size={21} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Eliminar ${display.title}`}
          onPress={onDelete}
          style={styles.action}
        >
          <Ionicons color={colors.danger} name="trash-outline" size={20} />
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flex: 1,
      borderRadius: 16,
      backgroundColor: colors.surface,
      padding: 6,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    top: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    illustration: { fontSize: 26, marginLeft: 4 },
    title: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
      lineHeight: 18,
    },
    quantityRow: { flexDirection: "row", justifyContent: "center", gap: 2 },
    quantityButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      backgroundColor: colors.background,
    },
    quantitySymbol: { color: colors.primary, fontSize: 24 },
    quantity: {
      color: colors.text,
      textAlign: "center",
      fontSize: 12,
      fontWeight: "600",
    },
    linkInfo: { gap: 4 },
    linkName: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    price: {
      color: colors.primary,
      fontWeight: "700",
      fontSize: 12,
      lineHeight: 17,
    },
    meta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
    actions: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 2,
      marginTop: "auto",
    },
    action: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
    },
  });
