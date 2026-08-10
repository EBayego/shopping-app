export interface MercadonaMarketContextValues {
  postalCode: string;
  warehouse: string;
}

export class MercadonaMarketContext {
  readonly postalCode: string;
  readonly warehouse: string;

  constructor(values: MercadonaMarketContextValues) {
    this.postalCode = values.postalCode;
    this.warehouse = values.warehouse;
    Object.freeze(this);
  }
}
