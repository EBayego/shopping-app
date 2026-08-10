export interface SupabaseRestClientOptions {
  url: string;
  serviceRoleKey: string;
  fetch?: typeof globalThis.fetch;
}

export class SupabaseRestClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: SupabaseRestClientOptions) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.serviceRoleKey = options.serviceRoleKey;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async select<T>(
    table: string,
    parameters: Readonly<Record<string, string>>,
  ): Promise<T[]> {
    const query = new URLSearchParams(parameters);
    return this.request<T[]>(`/rest/v1/${table}?${query.toString()}`);
  }

  async rpc<T>(
    name: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<T> {
    return this.request<T>(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Admin data query failed (${response.status}): ${detail}`,
      );
    }
    return (await response.json()) as T;
  }
}
