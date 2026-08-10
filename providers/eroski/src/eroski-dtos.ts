import type { ProductUnit } from "@shopping-app/domain";

export interface EroskiWeightDto {
  amount: number;
  unit: Exclude<ProductUnit, "unit">;
}

export interface EroskiUnitPriceDto {
  amount: number;
  unit: ProductUnit;
}

export interface EroskiProductDto {
  externalId: string;
  name: string;
  brand?: string;
  price: number;
  unitPrice?: EroskiUnitPriceDto;
  format?: string;
  weight?: EroskiWeightDto;
  shopRef: string;
  image?: string;
  availability: boolean;
  variableWeight: boolean;
  productUrl: string;
}
