import { normalizeText } from "@shopping-app/product-normalization";

import type { CreateGroupInput } from "./types";

export type CreateGroupErrors = Partial<Record<keyof CreateGroupInput, string>>;

export function isValidSpanishPostalCode(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

export function validateCreateGroup(
  input: CreateGroupInput,
): CreateGroupErrors {
  const errors: CreateGroupErrors = {};
  if (!input.groupName.trim())
    errors.groupName = "Escribe un nombre para el grupo.";
  if (!input.listName.trim())
    errors.listName = "Escribe un nombre para la lista.";
  if (!isValidSpanishPostalCode(input.postalCode)) {
    errors.postalCode = "El código postal debe tener cinco dígitos.";
  }
  return errors;
}

export function normalizeShoppingItemInput(rawText: string): {
  rawText: string;
  normalizedName: string;
} {
  const trimmed = rawText.trim();
  if (!trimmed) throw new TypeError("Escribe un producto.");

  const normalizedName = normalizeText(trimmed);
  if (!normalizedName)
    throw new TypeError("El producto debe contener texto reconocible.");
  return { rawText: trimmed, normalizedName };
}
