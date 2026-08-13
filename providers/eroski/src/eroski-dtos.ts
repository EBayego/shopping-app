import type { ProductUnit, PromotionType } from "@shopping-app/domain";

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
  normalPrice: number;
  promoPrice?: number;
  unitPrice?: EroskiUnitPriceDto;
  weight?: EroskiWeightDto;
  packageCount?: number;
  totalAmount?: number;
  shopRef: string;
  image?: string;
  availability: boolean;
  variableWeight: boolean;
  productUrl: string;
  category?: string;
  subcategory?: string;
  promotionType?: PromotionType;
  promotionText?: string;
  requiresMembership: boolean;
}

export interface EroskiCategoryDto {
  externalId: string;
  name: string;
  path: string;
  rootName: string;
  parentName?: string;
  order: number;
}
