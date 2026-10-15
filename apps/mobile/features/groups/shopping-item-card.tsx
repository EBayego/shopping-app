import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  onToggle,
  onEdit,
  onDelete,
  onLink,
  onQuantity,
  retailerEnabled = true,
}: {
  intent: ShoppingIntent;
  onToggle: () => void;
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
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const animate = (value: number) => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 35,
      bounciness: 3,
    }).start();
  };
  const ageHours = link
    ? (Date.now() - new Date(link.observedAt).getTime()) / 3_600_000
    : 0;
  const stale = freshnessLabel(
    ageHours >= 24 ? "VERY_STALE" : ageHours >= 6 ? "STALE" : "FRESH",
  );
  return (
    <Animated.View
      style={[
        styles.card,
        intent.checked && styles.checked,
        { transform: [{ scale }] },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        aria-checked={intent.checked}
        accessibilityState={{ checked: intent.checked }}
        accessibilityLabel={`${intent.checked ? "Desmarcar" : "Marcar"} ${display.title}`}
        onPress={onToggle}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        style={styles.main}
      >
        <View style={styles.top}>
          <Text style={styles.kind}>{link ? "ENLAZADO" : "TU LISTA"}</Text>
          <Ionicons
            name={intent.checked ? "checkmark-circle" : "ellipse-outline"}
            color={colors.primary}
            size={24}
          />
        </View>
        <Text accessible={false} style={styles.illustration}>
          {productIcon(intent.normalized_name)}
        </Text>
        <Text style={[styles.title, intent.checked && styles.checkedTitle]}>
          {display.title}
        </Text>
      </Pressable>
      <View style={styles.quantityRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reducir cantidad de ${display.title}`}
          onPress={() => onQuantity("decrement")}
          style={styles.quantityButton}
        >
          <Text style={styles.quantitySymbol}>−</Text>
        </Pressable>
        <Text style={styles.quantity}>
          {display.quantity}
          {display.unit ? ` ${display.unit}` : ""}
        </Text>
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
      ) : (
        <Text style={styles.freeHint}>Sin marca ni formato obligatorio</Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Enlazar ${display.title}`}
          onPress={onLink}
          style={styles.action}
        >
          <Ionicons color={colors.primary} name="link-outline" size={22} />
        </Pressable>
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
    </Animated.View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flex: 1,
      minWidth: 0,
      borderRadius: 24,
      backgroundColor: colors.surface,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    checked: { backgroundColor: colors.successBackground, opacity: 0.8 },
    main: { gap: 10, alignItems: "center" },
    top: {
      flexDirection: "row",
      width: "100%",
      justifyContent: "space-between",
      alignItems: "center",
    },
    kind: {
      color: colors.muted,
      fontSize: 10,
      letterSpacing: 0.8,
      fontWeight: "700",
    },
    illustration: { fontSize: 46, marginVertical: 4 },
    title: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      textAlign: "center",
      lineHeight: 23,
    },
    checkedTitle: { color: colors.muted, textDecorationLine: "line-through" },
    quantityRow: { flexDirection: "row", alignItems: "center", gap: 2 },
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
      flex: 1,
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
    freeHint: {
      color: colors.muted,
      fontSize: 11,
      textAlign: "center",
      lineHeight: 16,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-around",
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
