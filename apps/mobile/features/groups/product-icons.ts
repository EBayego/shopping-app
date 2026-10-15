/** Local, brand-independent illustrations. Adding an item never needs the network. */
const PRODUCT_ICONS: readonly (readonly [RegExp, string])[] = [
  [/\b(leche corporal|crema|champu|gel|jabon)\b/, "🧴"],
  [/\b(papel|servilletas|panuelos|rollos)\b/, "🧻"],
  [/\b(detergente|suavizante|lejia|limpiador|lavavajillas)\b/, "🧽"],
  [/\b(leche|leches|bebida de avena|bebida de soja)\b/, "🥛"],
  [/\b(huevo|huevos)\b/, "🥚"],
  [/\b(pan|baguette|tostadas|biscotes)\b/, "🍞"],
  [/\b(queso|quesos)\b/, "🧀"],
  [/\b(yogur|yogures|yogurt)\b/, "🥣"],
  [/\b(mantequilla|margarina)\b/, "🧈"],
  [/\b(pollo|pavo)\b/, "🍗"],
  [/\b(carne|ternera|cerdo|filete|filetes|hamburguesa)\b/, "🥩"],
  [/\b(pescado|salmon|merluza|atun|sardinas)\b/, "🐟"],
  [/\b(patata|patatas|papa|papas)\b/, "🥔"],
  [/\b(tomate|tomates)\b/, "🍅"],
  [/\b(lechuga|ensalada|espinacas|verdura|verduras|brocoli)\b/, "🥬"],
  [/\b(zanahoria|zanahorias)\b/, "🥕"],
  [/\b(cebolla|cebollas|ajo|ajos)\b/, "🧅"],
  [/\b(platano|platanos|banana|bananas)\b/, "🍌"],
  [/\b(manzana|manzanas|fruta|frutas|pera|peras)\b/, "🍎"],
  [/\b(naranja|naranjas|mandarina|mandarinas)\b/, "🍊"],
  [/\b(fresa|fresas|frutos rojos)\b/, "🍓"],
  [/\b(arroz)\b/, "🍚"],
  [/\b(pasta|espaguetis|macarrones)\b/, "🍝"],
  [/\b(lentejas|garbanzos|alubias|judias)\b/, "🫘"],
  [/\b(aceite|vinagre)\b/, "🫒"],
  [/\b(cafe|te|infusion|infusiones)\b/, "☕"],
  [/\b(agua|zumo|refresco|refrescos)\b/, "🧃"],
  [/\b(cerveza|cervezas)\b/, "🍺"],
  [/\b(vino)\b/, "🍷"],
  [/\b(galleta|galletas|cereales|avena)\b/, "🍪"],
  [/\b(chocolate|cacao)\b/, "🍫"],
  [/\b(helado|helados)\b/, "🍦"],
  [/\b(sal|azucar|harina)\b/, "🧂"],
  [/\b(perro|gato|pienso|mascota)\b/, "🐾"],
];

export function productIcon(name: string): string {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    PRODUCT_ICONS.find(([pattern]) => pattern.test(normalized))?.[1] ?? "🛒"
  );
}
