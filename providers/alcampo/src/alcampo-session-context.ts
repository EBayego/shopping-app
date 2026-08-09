export interface AlcampoSessionContextValues {
  globalSid: string;
  awsWafToken: string;
  csrfToken: string;
  marketExternalId: string;
  postalCode: string;
}

const ENVIRONMENT_KEYS = {
  globalSid: "ALCAMPO_GLOBAL_SID",
  awsWafToken: "ALCAMPO_AWS_WAF_TOKEN",
  csrfToken: "ALCAMPO_CSRF_TOKEN",
  marketExternalId: "ALCAMPO_MARKET_ID",
  postalCode: "ALCAMPO_POSTAL_CODE",
} as const;

export class AlcampoSessionContext {
  readonly globalSid: string;
  readonly awsWafToken: string;
  readonly csrfToken: string;
  readonly marketExternalId: string;
  readonly postalCode: string;

  constructor(values: AlcampoSessionContextValues) {
    this.globalSid = this.cookieValue(values.globalSid, "global_sid");
    this.awsWafToken = this.cookieValue(values.awsWafToken, "aws-waf-token");
    this.csrfToken = this.headerValue(values.csrfToken, "x-csrf-token");
    this.marketExternalId = this.nonEmpty(
      values.marketExternalId,
      "marketExternalId",
    );
    this.postalCode = this.nonEmpty(values.postalCode, "postalCode");
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv,
  ): AlcampoSessionContext | undefined {
    const values = Object.fromEntries(
      Object.entries(ENVIRONMENT_KEYS).map(([key, environmentKey]) => [
        key,
        environment[environmentKey],
      ]),
    ) as Record<keyof typeof ENVIRONMENT_KEYS, string | undefined>;
    if (
      Object.values(values).some(
        (value) => value === undefined || value.trim() === "",
      )
    ) {
      return undefined;
    }
    return new AlcampoSessionContext(values as AlcampoSessionContextValues);
  }

  requestHeaders(): Readonly<Record<string, string>> {
    return Object.freeze({
      accept: "application/json",
      cookie: `global_sid=${this.globalSid}; aws-waf-token=${this.awsWafToken}`,
      "x-csrf-token": this.csrfToken,
    });
  }

  private nonEmpty(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized === "")
      throw new TypeError(`Alcampo ${name} cannot be empty`);
    return normalized;
  }

  private headerValue(value: string, name: string): string {
    const normalized = this.nonEmpty(value, name);
    if (/\r|\n/.test(normalized))
      throw new TypeError(`Alcampo ${name} is invalid`);
    return normalized;
  }

  private cookieValue(value: string, name: string): string {
    const normalized = this.headerValue(value, name);
    if (normalized.includes(";"))
      throw new TypeError(`Alcampo ${name} is invalid`);
    return normalized;
  }
}
