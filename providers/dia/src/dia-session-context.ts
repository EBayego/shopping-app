export interface DiaSessionContextValues {
  postalCode: string;
  shopId?: string;
  cartId: string;
  sessionId: string;
}

export class DiaSessionContext {
  readonly postalCode: string;
  private resolvedShopId: string | undefined;
  readonly cartId: string;
  readonly sessionId: string;

  constructor(values: DiaSessionContextValues) {
    this.postalCode = values.postalCode;
    this.resolvedShopId = values.shopId;
    this.cartId = values.cartId;
    this.sessionId = values.sessionId;
  }

  get shopId(): string | undefined {
    return this.resolvedShopId;
  }

  resolveShopId(shopId: string): void {
    if (this.resolvedShopId !== undefined && this.resolvedShopId !== shopId) {
      throw new Error(
        `DIA shop changed from ${this.resolvedShopId} to ${shopId} within one session`,
      );
    }
    this.resolvedShopId = shopId;
  }
}
