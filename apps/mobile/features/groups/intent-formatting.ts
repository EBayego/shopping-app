import type { ShoppingIntent } from "./types";
import type { ShoppingPackageType } from "@shopping-app/voice-parser";

type DisplayIntent = Pick<
  ShoppingIntent,
  | "normalized_name"
  | "package_count"
  | "package_size"
  | "package_unit"
  | "raw_text"
  | "requested_quantity"
  | "requested_unit"
  | "variant"
> & {
  package_type?: ShoppingPackageType | null;
  brand_preference?: string | null;
};

export interface ShoppingIntentDisplay {
  title: string;
  quantity: string;
  unit: string | null;
}

const UNIT_LABELS: Readonly<Record<string, string>> = {
  g: "G",
  kg: "Kg",
  l: "L",
  ml: "Ml",
  unit: "Uds.",
};

const CONTAINER_LABELS: Readonly<
  Record<string, readonly [singular: string, plural: string]>
> = {
  bote: ["Bote", "Botes"],
  botes: ["Bote", "Botes"],
  botella: ["Botella", "Botellas"],
  botellas: ["Botella", "Botellas"],
  lata: ["Lata", "Latas"],
  latas: ["Lata", "Latas"],
  pack: ["Pack", "Packs"],
  packs: ["Pack", "Packs"],
  paquete: ["Paquete", "Paquetes"],
  paquetes: ["Paquete", "Paquetes"],
};

export function formatShoppingIntent(
  intent: DisplayIntent,
): ShoppingIntentDisplay {
  const quantity = intent.package_count ?? intent.requested_quantity ?? 1;
  const measuredRequest =
    intent.package_count === null &&
    intent.requested_unit !== null &&
    intent.requested_unit !== "unit";
  const measuredUnit = requestedUnitLabel(intent.requested_unit, quantity);
  return {
    title: productTitle(intent, quantity),
    quantity: numberText(quantity),
    unit: measuredRequest
      ? intent.package_type == null
        ? measuredUnit
        : `${measuredUnit} · ${packageUnitLabel(intent, 1)}`
      : intent.package_count === null && intent.package_type == null
        ? measuredUnit
        : packageUnitLabel(intent, quantity),
  };
}

function productTitle(intent: DisplayIntent, quantity: number): string {
  const hasStructuredVoiceFields =
    intent.brand_preference != null ||
    intent.package_type != null ||
    intent.requested_unit !== null ||
    intent.package_count !== null ||
    intent.package_size !== null ||
    intent.variant !== null;
  let name = (
    hasStructuredVoiceFields ? intent.normalized_name : intent.raw_text
  ).trim();
  const variant = intent.variant?.trim();
  if (variant && !normalize(name).includes(normalize(variant))) {
    name = `${name} ${variant}`;
  }
  if (intent.requested_unit === "unit" && quantity !== 1) {
    const plurals: Readonly<Record<string, string>> = {
      huevo: "huevos",
      yogur: "yogures",
    };
    name = plurals[name] ?? name;
  }
  const brand = intent.brand_preference?.trim();
  if (brand && !normalize(name).includes(normalize(brand))) {
    name = `${name} ${brand}`;
  }
  return capitalizeFirst(name);
}

function requestedUnitLabel(
  unit: string | null,
  quantity: number,
): string | null {
  if (unit === null) return null;
  if (unit === "unit") return quantity === 1 ? "Ud." : "Uds.";
  return UNIT_LABELS[unit] ?? capitalizeFirst(unit);
}

function packageUnitLabel(intent: DisplayIntent, quantity: number): string {
  const normalizedRaw = normalize(intent.raw_text);
  const container = normalizedRaw.match(
    /\b(botes?|botellas?|latas?|packs?|paquetes?)\b/,
  )?.[1];
  const typeLabels: Readonly<
    Record<ShoppingPackageType, readonly [string, string]>
  > = {
    bottle: ["Botella", "Botellas"],
    can: ["Lata", "Latas"],
    carton: ["Brik", "Briks"],
    bag: ["Bolsa", "Bolsas"],
    tray: ["Bandeja", "Bandejas"],
    jar: ["Bote", "Botes"],
    box: ["Caja", "Cajas"],
    pack: ["Pack", "Packs"],
    tub: ["Tarrina", "Tarrinas"],
    tube: ["Tubo", "Tubos"],
    jug: ["Garrafa", "Garrafas"],
  };
  const labels =
    intent.package_type == null
      ? container === undefined
        ? undefined
        : CONTAINER_LABELS[container]
      : typeLabels[intent.package_type];
  const containerLabel =
    labels?.[quantity === 1 ? 0 : 1] ?? (quantity === 1 ? "Envase" : "Envases");
  if (intent.package_size === null || intent.package_unit === null) {
    return containerLabel;
  }
  const sizeUnit =
    UNIT_LABELS[intent.package_unit] ?? capitalizeFirst(intent.package_unit);
  return `${containerLabel} de ${numberText(intent.package_size)} ${sizeUnit}`;
}

function numberText(value: number): string {
  return String(value).replace(".", ",");
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
