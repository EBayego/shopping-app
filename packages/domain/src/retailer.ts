export const RETAILERS = ["DIA", "MERCADONA", "ALCAMPO", "EROSKI"] as const;

export type Retailer = (typeof RETAILERS)[number];

export function isRetailer(value: string): value is Retailer {
  return (RETAILERS as readonly string[]).includes(value);
}
