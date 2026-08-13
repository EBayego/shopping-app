export interface EroskiSessionContextOptions {
  shopRef: string;
  shopName: string;
  cookies: ReadonlyMap<string, string>;
  homeHtml: string;
  homeUrl: string;
}

export class EroskiSessionContext {
  readonly shopRef: string;
  readonly shopName: string;
  readonly homeHtml: string;
  readonly homeUrl: string;
  private readonly cookies: Map<string, string>;

  constructor(options: EroskiSessionContextOptions) {
    this.shopRef = options.shopRef;
    this.shopName = options.shopName;
    this.cookies = new Map(options.cookies);
    this.homeHtml = options.homeHtml;
    this.homeUrl = options.homeUrl;
  }

  cookieHeader(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  captureCookies(values: readonly string[]): void {
    for (const value of values) {
      for (const match of value.matchAll(
        /(?:^|,\s*)([A-Za-z0-9_.-]+)=([^;,]*)/g,
      )) {
        if (match[1] !== undefined && match[2] !== undefined)
          this.cookies.set(match[1], match[2]);
      }
    }
  }

  fork(): EroskiSessionContext {
    return new EroskiSessionContext({
      shopRef: this.shopRef,
      shopName: this.shopName,
      cookies: this.cookies,
      homeHtml: this.homeHtml,
      homeUrl: this.homeUrl,
    });
  }
}
