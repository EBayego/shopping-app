import type {
  ShoppingIntentDraft,
  ShoppingIntentUnit,
} from "@shopping-app/voice-parser";
import { StyleSheet, Text, View } from "react-native";

import { AppInput } from "../../components/app-input";
import { spacing, type ThemeColors } from "../../lib/theme";
import { useThemedStyles } from "../theme/theme-context";

export interface ShoppingIntentFieldValues {
  product: string;
  variant: string;
  brandPreference: string;
  requestedQuantity: string;
  requestedUnit: string;
  packageCount: string;
  packageSize: string;
  packageUnit: string;
}

interface ShoppingIntentFieldsProps {
  autoFocus?: boolean;
  onChange: (patch: Partial<ShoppingIntentFieldValues>) => void;
  showEmptyOptionalFields?: boolean;
  values: ShoppingIntentFieldValues;
}

const VALID_UNITS = new Set<ShoppingIntentUnit>([
  "g",
  "kg",
  "ml",
  "cl",
  "l",
  "unit",
  "bottle",
  "can",
  "pack",
]);

const UNIT_ALIASES: Readonly<Record<string, ShoppingIntentUnit>> = {
  ud: "unit",
  "ud.": "unit",
  unidad: "unit",
  unidades: "unit",
  botella: "bottle",
  botellas: "bottle",
  lata: "can",
  latas: "can",
  paquete: "pack",
  paquetes: "pack",
};

export function ShoppingIntentFields({
  autoFocus = false,
  onChange,
  showEmptyOptionalFields = false,
  values,
}: ShoppingIntentFieldsProps) {
  const styles = useThemedStyles(createStyles);
  const showPackaging =
    showEmptyOptionalFields ||
    Boolean(values.packageCount || values.packageSize || values.packageUnit);

  return (
    <View style={styles.fields}>
      <AppInput
        autoFocus={autoFocus}
        label="Producto"
        onChangeText={(product) => onChange({ product })}
        value={values.product}
      />
      {showEmptyOptionalFields || values.variant.trim() ? (
        <AppInput
          label="Variante"
          onChangeText={(variant) => onChange({ variant })}
          placeholder="Ej. semidesnatada"
          value={values.variant}
        />
      ) : null}
      {showEmptyOptionalFields || values.brandPreference.trim() ? (
        <AppInput
          label="Marca"
          onChangeText={(brandPreference) => onChange({ brandPreference })}
          placeholder="Opcional"
          value={values.brandPreference}
        />
      ) : null}
      <View style={styles.fieldRow}>
        <AppInput
          keyboardType="decimal-pad"
          label="Cantidad"
          onChangeText={(requestedQuantity) => onChange({ requestedQuantity })}
          placeholder="Ej. 2"
          style={styles.rowInput}
          value={values.requestedQuantity}
        />
        {showEmptyOptionalFields || shouldShowUnit(values.requestedUnit) ? (
          <AppInput
            autoCapitalize="none"
            label="Unidad"
            onChangeText={(requestedUnit) => onChange({ requestedUnit })}
            placeholder="ud, kg, g, l o ml"
            style={styles.rowInput}
            value={values.requestedUnit}
          />
        ) : null}
      </View>
      {showPackaging ? (
        <View style={styles.packageBox}>
          <Text style={styles.label}>Formato del envase</Text>
          <View style={styles.fieldRow}>
            <AppInput
              keyboardType="number-pad"
              label="Envases"
              onChangeText={(packageCount) => onChange({ packageCount })}
              placeholder="Ej. 2"
              style={styles.rowInput}
              value={values.packageCount}
            />
            <AppInput
              keyboardType="decimal-pad"
              label="TamaÃ±o"
              onChangeText={(packageSize) => onChange({ packageSize })}
              placeholder="Ej. 500"
              style={styles.rowInput}
              value={values.packageSize}
            />
            {showEmptyOptionalFields || shouldShowUnit(values.packageUnit) ? (
              <AppInput
                autoCapitalize="none"
                label="Unidad envase"
                onChangeText={(packageUnit) => onChange({ packageUnit })}
                placeholder="kg, g, l o ml"
                style={styles.rowInput}
                value={values.packageUnit}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function draftToFieldValues(
  draft: ShoppingIntentDraft,
): ShoppingIntentFieldValues {
  return {
    product: capitalizeFirst(draft.product ?? ""),
    variant: draft.variant ?? "",
    brandPreference: draft.brandPreference ?? "",
    requestedQuantity: numberText(draft.requestedQuantity),
    requestedUnit: unitText(draft.requestedUnit),
    packageCount: numberText(draft.packageCount),
    packageSize: numberText(draft.packageSize),
    packageUnit: unitText(draft.packageUnit),
  };
}

export function fieldValuesToDraft(
  values: ShoppingIntentFieldValues,
  source: Pick<ShoppingIntentDraft, "confidence" | "rawText">,
): ShoppingIntentDraft {
  const product = values.product.trim();
  if (!product) {
    throw new TypeError("El producto no puede estar vacÃ­o.");
  }
  const requestedQuantity = optionalPositiveNumber(
    values.requestedQuantity,
    "cantidad",
  );
  const requestedUnit = optionalUnit(values.requestedUnit, "unidad");
  if ((requestedQuantity === undefined) !== (requestedUnit === undefined)) {
    throw new TypeError("La cantidad y su unidad deben indicarse juntas.");
  }
  const packageCount = optionalPositiveInteger(
    values.packageCount,
    "nÃºmero de envases",
  );
  const packageSize = optionalPositiveNumber(
    values.packageSize,
    "tamaÃ±o del envase",
  );
  const packageUnit = optionalUnit(values.packageUnit, "unidad del envase");
  if ((packageSize === undefined) !== (packageUnit === undefined)) {
    throw new TypeError(
      "El tamaÃ±o y la unidad del envase deben indicarse juntos.",
    );
  }
  const totalAmount =
    packageSize !== undefined
      ? (packageCount ?? requestedQuantity ?? 1) * packageSize
      : requestedQuantity !== undefined &&
          requestedUnit !== undefined &&
          !isContainerUnit(requestedUnit)
        ? requestedQuantity
        : undefined;

  return {
    ...source,
    product,
    ...(values.variant.trim() ? { variant: values.variant.trim() } : {}),
    ...(values.brandPreference.trim()
      ? { brandPreference: values.brandPreference.trim() }
      : {}),
    ...(requestedQuantity === undefined ? {} : { requestedQuantity }),
    ...(requestedUnit === undefined ? {} : { requestedUnit }),
    ...(packageCount === undefined ? {} : { packageCount }),
    ...(packageSize === undefined ? {} : { packageSize }),
    ...(packageUnit === undefined ? {} : { packageUnit }),
    ...(totalAmount === undefined ? {} : { totalAmount }),
  };
}

function optionalPositiveNumber(
  value: string,
  label: string,
): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError(`La ${label} debe ser un nÃºmero mayor que cero.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  value: string,
  label: string,
): number | undefined {
  const parsed = optionalPositiveNumber(value, label);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    throw new TypeError(`El ${label} debe ser un nÃºmero entero.`);
  }
  return parsed;
}

function optionalUnit(
  value: string,
  label: string,
): ShoppingIntentUnit | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  const unit = UNIT_ALIASES[normalized] ?? normalized;
  if (!VALID_UNITS.has(unit as ShoppingIntentUnit)) {
    throw new TypeError(`La ${label} no es vÃ¡lida.`);
  }
  return unit as ShoppingIntentUnit;
}

function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value).replace(".", ",");
}

function unitText(value: ShoppingIntentUnit | undefined): string {
  if (value === undefined || value === "unit") return "";
  return capitalizeFirst(value);
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function shouldShowUnit(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unit";
}

function isContainerUnit(unit: ShoppingIntentUnit): boolean {
  return (
    unit === "unit" || unit === "bottle" || unit === "can" || unit === "pack"
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fields: { gap: spacing.sm },
    fieldRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    rowInput: { minWidth: 112 },
    packageBox: { gap: spacing.sm },
    label: { color: colors.text, fontWeight: "700" },
  });
