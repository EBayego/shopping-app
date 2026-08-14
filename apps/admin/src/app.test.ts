import { describe, expect, it, vi } from "vitest";

import { createAdminApplication } from "./app.js";

function queryService() {
  return {
    providers: vi.fn().mockResolvedValue([]),
    syncRuns: vi.fn().mockResolvedValue([]),
    catalog: vi.fn().mockResolvedValue([]),
    matching: vi.fn().mockResolvedValue([]),
    refreshRequests: vi.fn().mockResolvedValue([]),
    audit: vi.fn().mockResolvedValue([]),
    anomalyInputs: vi.fn().mockResolvedValue({
      retailers: [],
      products: [],
      offers: [],
      history: [],
      runs: [],
    }),
  };
}

function actionService() {
  return {
    setProviderStatus: vi.fn().mockResolvedValue(undefined),
    requestRefresh: vi.fn().mockResolvedValue(undefined),
    acceptMatch: vi.fn().mockResolvedValue(undefined),
    rejectMatch: vi.fn().mockResolvedValue(undefined),
    classifyProduct: vi.fn().mockResolvedValue(undefined),
    updateConcept: vi.fn().mockResolvedValue(undefined),
  };
}

const credentials = {
  username: "admin",
  password: "a-very-long-admin-password",
};
const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;

describe("admin application permissions", () => {
  it("returns 401 before executing any data query", async () => {
    const queries = queryService();
    const application = createAdminApplication({
      credentials,
      queries,
      actions: actionService(),
    });
    const response = await application(new Request("http://admin.local/"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
    expect(queries.providers).not.toHaveBeenCalled();
  });

  it("executes a protected route only with valid credentials", async () => {
    const queries = queryService();
    const application = createAdminApplication({
      credentials,
      queries,
      actions: actionService(),
    });
    const response = await application(
      new Request("http://admin.local/catalog?active=false&q=leche", {
        headers: { authorization },
      }),
    );
    expect(response.status).toBe(200);
    expect(queries.catalog).toHaveBeenCalledWith({
      active: false,
      query: "leche",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not disclose backend errors or secrets", async () => {
    const queries = queryService();
    queries.providers.mockRejectedValue(new Error("service-secret-value"));
    const application = createAdminApplication({
      credentials,
      queries,
      actions: actionService(),
      logger: { error: vi.fn() },
    });
    const response = await application(
      new Request("http://admin.local/", { headers: { authorization } }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("service-secret-value");
  });

  it("rejects cross-origin mutations before calling an action", async () => {
    const queries = queryService();
    const actions = actionService();
    const application = createAdminApplication({
      credentials,
      queries,
      actions,
    });
    const response = await application(
      new Request("http://admin.local/actions/provider-status", {
        method: "POST",
        headers: {
          authorization,
          origin: "https://attacker.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "retailerId=00000000-0000-4000-8000-000000000001&status=DISABLED",
      }),
    );
    expect(response.status).toBe(403);
    expect(actions.setProviderStatus).not.toHaveBeenCalled();
  });

  it("executes same-origin mutations and redirects", async () => {
    const queries = queryService();
    const actions = actionService();
    const application = createAdminApplication({
      credentials,
      queries,
      actions,
    });
    const response = await application(
      new Request("http://admin.local/actions/provider-status", {
        method: "POST",
        headers: {
          authorization,
          origin: "http://admin.local",
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "same-origin",
        },
        body: "retailerId=00000000-0000-4000-8000-000000000001&status=DISABLED",
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(actions.setProviderStatus).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "DISABLED",
    );
  });
});
