export interface AlcampoSessionContextValues {
  postalCode: string;
  regionId: string;
  deliveryDestinationId: string;
  visitorId: string;
  assetVersion?: string;
  cartId?: string;
  csrfToken?: string;
  globalSid?: string;
  awsWafToken?: string;
}

const ENVIRONMENT_KEYS = {
  postalCode: "ALCAMPO_POSTAL_CODE",
  regionId: "ALCAMPO_REGION_ID",
  deliveryDestinationId: "ALCAMPO_DELIVERY_DESTINATION_ID",
  visitorId: "ALCAMPO_VISITOR_ID",
  assetVersion: "ALCAMPO_ASSET_VERSION",
  cartId: "ALCAMPO_CART_ID",
  csrfToken: "ALCAMPO_CSRF_TOKEN",
  globalSid: "ALCAMPO_GLOBAL_SID",
  awsWafToken: "ALCAMPO_AWS_WAF_TOKEN",
} as const;

export class AlcampoSessionContext {
  readonly postalCode: string;
  readonly regionId: string;
  readonly deliveryDestinationId: string;
  readonly visitorId: string;
  readonly assetVersion: string | undefined;
  readonly cartId: string | undefined;
  readonly csrfToken: string | undefined;
  readonly globalSid: string | undefined;
  readonly awsWafToken: string | undefined;

  constructor(values: AlcampoSessionContextValues) {
    this.postalCode = this.nonEmpty(values.postalCode, "postalCode");
    this.regionId = this.nonEmpty(values.regionId, "regionId");
    this.deliveryDestinationId = this.nonEmpty(
      values.deliveryDestinationId,
      "deliveryDestinationId",
    );
    this.visitorId = this.headerValue(values.visitorId, "visitorId");
    this.assetVersion = this.optionalHeader(
      values.assetVersion,
      "assetVersion",
    );
    this.cartId = this.optional(values.cartId, "cartId");
    this.csrfToken = this.optionalHeader(values.csrfToken, "x-csrf-token");
    this.globalSid = this.optionalCookie(values.globalSid, "global_sid");
    this.awsWafToken = this.optionalCookie(values.awsWafToken, "aws-waf-token");
    Object.freeze(this);
  }

  get marketExternalId(): string {
    return this.regionId;
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv,
  ): AlcampoSessionContext | undefined {
    const required = {
      postalCode: environment[ENVIRONMENT_KEYS.postalCode],
      regionId:
        environment[ENVIRONMENT_KEYS.regionId] ?? environment.ALCAMPO_MARKET_ID,
      deliveryDestinationId:
        environment[ENVIRONMENT_KEYS.deliveryDestinationId],
      visitorId: environment[ENVIRONMENT_KEYS.visitorId],
    };
    if (Object.values(required).some((value) => !value?.trim()))
      return undefined;
    return new AlcampoSessionContext({
      postalCode: required.postalCode as string,
      regionId: required.regionId as string,
      deliveryDestinationId: required.deliveryDestinationId as string,
      visitorId: required.visitorId as string,
      ...this.optionalEnvironment(environment, ENVIRONMENT_KEYS),
    });
  }

  requestHeaders(): Readonly<Record<string, string>> {
    const cookies = [
      this.globalSid === undefined ? undefined : `global_sid=${this.globalSid}`,
      this.awsWafToken === undefined
        ? undefined
        : `aws-waf-token=${this.awsWafToken}`,
    ].filter((value): value is string => value !== undefined);
    return Object.freeze({
      accept: "application/json",
      "visitor-id": this.visitorId,
      visitorid: this.visitorId,
      "ecom-request-source": "web",
      ...(this.csrfToken === undefined
        ? {}
        : { "x-csrf-token": this.csrfToken }),
      ...(this.assetVersion === undefined
        ? {}
        : { "ecom-request-source-version": this.assetVersion }),
      ...(cookies.length === 0 ? {} : { cookie: cookies.join("; ") }),
    });
  }

  private static optionalEnvironment(
    environment: NodeJS.ProcessEnv,
    keys: typeof ENVIRONMENT_KEYS,
  ): Partial<
    Pick<
      AlcampoSessionContextValues,
    | "cartId"
    | "csrfToken"
    | "globalSid"
    | "awsWafToken"
    | "assetVersion"
    >
  > {
    const cartId = environment[keys.cartId];
    const csrfToken = environment[keys.csrfToken];
    const globalSid = environment[keys.globalSid];
    const awsWafToken = environment[keys.awsWafToken];
    const assetVersion = environment[keys.assetVersion];
    return {
      ...(cartId === undefined ? {} : { cartId }),
      ...(csrfToken === undefined ? {} : { csrfToken }),
      ...(globalSid === undefined ? {} : { globalSid }),
      ...(awsWafToken === undefined ? {} : { awsWafToken }),
      ...(assetVersion === undefined ? {} : { assetVersion }),
    };
  }

  private nonEmpty(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized === "")
      throw new TypeError(`Alcampo ${name} cannot be empty`);
    return normalized;
  }

  private optional(
    value: string | undefined,
    name: string,
  ): string | undefined {
    return value === undefined ? undefined : this.nonEmpty(value, name);
  }

  private headerValue(value: string, name: string): string {
    const normalized = this.nonEmpty(value, name);
    if (/\r|\n/.test(normalized))
      throw new TypeError(`Alcampo ${name} is invalid`);
    return normalized;
  }

  private optionalHeader(
    value: string | undefined,
    name: string,
  ): string | undefined {
    return value === undefined ? undefined : this.headerValue(value, name);
  }

  private optionalCookie(
    value: string | undefined,
    name: string,
  ): string | undefined {
    const normalized = this.optionalHeader(value, name);
    if (normalized?.includes(";"))
      throw new TypeError(`Alcampo ${name} is invalid`);
    return normalized;
  }
}
