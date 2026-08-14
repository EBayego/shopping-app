import { detectAnomalies } from "./anomalies.js";
import { AdminActions, parseProductIds } from "./actions.js";
import { isAuthorizedHeader, type AdminCredentials } from "./auth.js";
import { AdminQueries, type MatchingFilter } from "./queries.js";
import {
  renderAnomalies,
  renderAudit,
  renderCatalog,
  renderError,
  renderMatching,
  renderProviders,
  renderRefreshRequests,
  renderSyncRuns,
} from "./render.js";

export interface AdminApplicationDependencies {
  credentials: AdminCredentials;
  queries: Pick<
    AdminQueries,
    | "providers"
    | "syncRuns"
    | "catalog"
    | "matching"
    | "anomalyInputs"
    | "refreshRequests"
    | "audit"
  >;
  actions: Pick<
    AdminActions,
    | "setProviderStatus"
    | "requestRefresh"
    | "acceptMatch"
    | "rejectMatch"
    | "classifyProduct"
    | "updateConcept"
  >;
  logger?: Pick<Console, "error">;
}

export function createAdminApplication(
  dependencies: AdminApplicationDependencies,
) {
  const logger = dependencies.logger ?? console;
  return async (request: Request): Promise<Response> => {
    const headers = securityHeaders();
    if (
      !isAuthorizedHeader(
        request.headers.get("authorization") ?? undefined,
        dependencies.credentials,
      )
    ) {
      headers.set(
        "WWW-Authenticate",
        'Basic realm="shopping-app admin", charset="UTF-8"',
      );
      return html(renderError(401, "Autorización requerida"), 401, headers);
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "POST"
    ) {
      headers.set("Allow", "GET, HEAD, POST");
      return html(renderError(405, "Método no permitido"), 405, headers);
    }

    try {
      const url = new URL(request.url);
      if (request.method === "POST") {
        if (!isSameOriginMutation(request, url)) {
          return html(
            renderError(403, "Origen de acción no permitido"),
            403,
            headers,
          );
        }
        const redirectTo = await handleAction(
          request,
          url,
          dependencies.actions,
        );
        headers.set("Location", redirectTo);
        return new Response(null, { status: 303, headers });
      }
      let body: string;
      if (url.pathname === "/") {
        body = renderProviders(await dependencies.queries.providers());
      } else if (url.pathname === "/sync-runs") {
        body = renderSyncRuns(await dependencies.queries.syncRuns());
      } else if (url.pathname === "/refresh-requests") {
        body = renderRefreshRequests(
          await dependencies.queries.refreshRequests(),
        );
      } else if (url.pathname === "/catalog") {
        const active = parseActive(url.searchParams.get("active"));
        const query = url.searchParams.get("q")?.slice(0, 100);
        const filters = {
          ...(query === undefined ? {} : { query }),
          ...(active === undefined ? {} : { active }),
        };
        body = renderCatalog(
          await dependencies.queries.catalog(filters),
          filters,
        );
      } else if (url.pathname === "/matching") {
        const filter = parseMatchingFilter(url.searchParams.get("status"));
        body = renderMatching(
          await dependencies.queries.matching(filter),
          filter,
        );
      } else if (url.pathname === "/anomalies") {
        body = renderAnomalies(
          detectAnomalies(await dependencies.queries.anomalyInputs()),
        );
      } else if (url.pathname === "/audit") {
        body = renderAudit(await dependencies.queries.audit());
      } else {
        return html(renderError(404, "Página no encontrada"), 404, headers);
      }
      return html(request.method === "HEAD" ? "" : body, 200, headers);
    } catch (error) {
      logger.error("admin.request.failed", error);
      return html(
        renderError(
          error instanceof TypeError ? 400 : 500,
          error instanceof TypeError
            ? "La acción contiene datos no válidos"
            : "No se pudieron procesar los datos",
        ),
        error instanceof TypeError ? 400 : 500,
        headers,
      );
    }
  };
}

async function handleAction(
  request: Request,
  url: URL,
  actions: AdminApplicationDependencies["actions"],
): Promise<string> {
  const form = await request.formData();
  if (url.pathname === "/actions/provider-status") {
    await actions.setProviderStatus(
      requiredForm(form, "retailerId"),
      requiredForm(form, "status"),
    );
    return "/";
  }
  if (url.pathname === "/actions/refresh-request") {
    await actions.requestRefresh({
      retailerId: requiredForm(form, "retailerId"),
      requestType: requiredForm(form, "requestType"),
      postalCode: requiredForm(form, "postalCode"),
      productIds: parseProductIds(optionalForm(form, "productIds")),
    });
    return "/refresh-requests";
  }
  if (url.pathname === "/actions/match-accept") {
    await actions.acceptMatch(requiredForm(form, "matchId"));
    return "/matching?status=accepted";
  }
  if (url.pathname === "/actions/match-reject") {
    await actions.rejectMatch(requiredForm(form, "matchId"));
    return "/matching?status=rejected";
  }
  if (url.pathname === "/actions/match-reassign") {
    await actions.classifyProduct(
      requiredForm(form, "retailerProductId"),
      requiredForm(form, "productConceptId"),
    );
    return "/matching?status=accepted";
  }
  if (url.pathname === "/actions/concept-update") {
    await actions.updateConcept(requiredForm(form, "productConceptId"), {
      name: requiredForm(form, "name"),
      base_name: requiredForm(form, "base_name"),
      category: optionalForm(form, "category"),
      aliases: parseProductIds(optionalForm(form, "aliases")),
      default_dimension: requiredForm(form, "default_dimension"),
      default_amount: optionalForm(form, "default_amount"),
      default_unit: optionalForm(form, "default_unit"),
      selection_policy: requiredForm(form, "selection_policy"),
    });
    return "/matching?status=accepted";
  }
  throw new TypeError("Unknown admin action");
}

function requiredForm(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function optionalForm(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isSameOriginMutation(request: Request, url: URL): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    request.headers.get("origin") === url.origin &&
    contentType.startsWith("application/x-www-form-urlencoded") &&
    (fetchSite === null || fetchSite === "same-origin")
  );
}

function parseActive(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseMatchingFilter(value: string | null): MatchingFilter {
  return value === "low" ||
    value === "pending" ||
    value === "accepted" ||
    value === "rejected"
    ? value
    : "unmatched";
}

function securityHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}

function html(body: string, status: number, headers: Headers): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
}
