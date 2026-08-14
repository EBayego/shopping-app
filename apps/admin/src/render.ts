import type { Anomaly } from "./anomalies.js";
import type { AuditRow } from "./models.js";
import type {
  CatalogView,
  MatchingFilter,
  ClassificationView,
  ProviderSummary,
  RefreshRequestView,
  SyncRunView,
} from "./queries.js";

export function renderProviders(rows: ProviderSummary[]): string {
  return layout(
    "Providers",
    `<section class="summary">${rows
      .map(
        (row) => `<article class="card">
          <div class="card-title"><strong>${escapeHtml(row.provider)}</strong>${badge(row.state)}</div>
          <dl>
            <dt>Success rate</dt><dd>${row.successRate === null ? "—" : `${row.successRate.toFixed(1)}%`}</dd>
            <dt>Último éxito</dt><dd>${date(row.lastSuccessAt)}</dd>
            <dt>Último fallo</dt><dd>${date(row.lastFailureAt)}</dd>
            <dt>Último sync</dt><dd>${date(row.lastSyncAt)}</dd>
            <dt>Duración</dt><dd>${duration(row.durationMs)}</dd>
          </dl>
          <p class="error">${escapeHtml(row.lastError ?? "Sin errores recientes")}</p>
          <form class="inline-form" method="post" action="/actions/provider-status">
            <input type="hidden" name="retailerId" value="${escapeHtml(row.retailerId)}">
            <label>Estado <select name="status">${[
              "ACTIVE",
              "DEGRADED",
              "DISABLED",
            ]
              .map(
                (status) =>
                  `<option${status === row.state ? " selected" : ""}>${status}</option>`,
              )
              .join("")}</select></label><button>Actualizar</button>
          </form>
          ${renderRefreshForms(row)}
          <details><summary>Métricas disponibles</summary><pre>${escapeHtml(JSON.stringify(row.metrics, null, 2))}</pre></details>
        </article>`,
      )
      .join("")}</section>`,
  );
}

export function renderSyncRuns(rows: SyncRunView[]): string {
  return layout(
    "Sync runs",
    table(
      [
        "Provider",
        "Strategy",
        "StartedAt",
        "EndedAt",
        "Status",
        "Products",
        "Offers",
        "Failures",
      ],
      rows.map((row) => [
        row.provider,
        row.sync_type,
        date(row.started_at),
        date(row.finished_at),
        badge(row.status.toUpperCase()),
        String(row.products_seen),
        String(row.offers_seen),
        String(row.failures),
      ]),
    ),
  );
}

export function renderCatalog(
  rows: CatalogView[],
  filters: { query?: string; active?: boolean },
): string {
  const activeValue =
    filters.active === undefined ? "all" : String(filters.active);
  return layout(
    "Catálogo",
    `<form class="filters" method="get">
      <label>Buscar <input name="q" value="${escapeHtml(filters.query ?? "")}" maxlength="100"></label>
      <label>Estado <select name="active">
        <option value="all"${activeValue === "all" ? " selected" : ""}>Todos</option>
        <option value="true"${activeValue === "true" ? " selected" : ""}>Activos</option>
        <option value="false"${activeValue === "false" ? " selected" : ""}>Inactivos</option>
      </select></label><button>Consultar</button>
    </form>${table(
      [
        "Provider",
        "Producto",
        "External ID",
        "Estado",
        "Last seen",
        "Ofertas",
        "Freshness",
      ],
      rows.map((row) => [
        row.provider,
        row.name,
        row.external_id,
        badge(row.active ? "ACTIVE" : "INACTIVE"),
        date(row.last_seen_at),
        row.offers.length === 0
          ? "—"
          : row.offers
              .map(
                (offer) =>
                  `${(offer.promo_price ?? offer.normal_price).toFixed(2)} €${offer.available ? "" : " (no disponible)"}`,
              )
              .join(" · "),
        badge(row.freshness),
      ]),
    )}`,
  );
}

export function renderMatching(
  rows: ClassificationView[],
  filter: MatchingFilter,
): string {
  const filters: Array<[MatchingFilter, string]> = [
    ["unmatched", "Unmatched"],
    ["low", "LOW confidence"],
    ["pending", "Pending review"],
    ["accepted", "Accepted"],
    ["rejected", "Rejected"],
  ];
  return layout(
    "Matching",
    `<nav class="tabs">${filters
      .map(
        ([value, label]) =>
          `<a${value === filter ? ' aria-current="page"' : ""} href="/matching?status=${value}">${label}</a>`,
      )
      .join("")}</nav>${table(
      [
        "Provider",
        "Retailer product",
        "Concepto",
        "Method",
        "Score",
        "Confidence",
        "Status",
        "Updated",
        "Acciones",
      ],
      rows.map((row) => [
        row.provider,
        row.retailerProduct,
        row.productConcept ?? "—",
        row.method ?? "—",
        row.score === null ? "—" : row.score.toFixed(3),
        row.confidence === null ? "—" : badge(row.confidence),
        badge(row.status),
        date(row.updatedAt),
        renderClassificationActions(row),
      ]),
    )}`,
  );
}

export function renderAnomalies(rows: Anomaly[]): string {
  return layout(
    "Anomalías",
    `<p class="muted">Cambios extremos: ≥50%. Price per unit incoherente: desviación &gt;20%.</p>${table(
      ["Tipo", "Provider", "Sujeto", "Detalle", "Fecha"],
      rows.map((row) => [
        badge(row.kind),
        row.provider,
        row.subject,
        row.detail,
        date(row.occurredAt),
      ]),
    )}`,
  );
}

export function renderRefreshRequests(rows: RefreshRequestView[]): string {
  return layout(
    "Refresh requests",
    `<p class="muted">La cola es consumida por el worker; el navegador no contacta providers.</p>${table(
      [
        "Provider",
        "Tipo",
        "CP",
        "Estado",
        "Actor",
        "Solicitada",
        "Inicio",
        "Fin",
        "Intentos",
        "Error",
      ],
      rows.map((row) => [
        row.provider,
        row.request_type,
        row.postal_code,
        badge(row.status),
        row.requested_by,
        date(row.requested_at),
        date(row.started_at),
        date(row.finished_at),
        String(row.attempt_count),
        row.error_message ?? "—",
      ]),
    )}`,
  );
}

export function renderAudit(rows: AuditRow[]): string {
  return layout(
    "Auditoría",
    table(
      ["Actor", "Acción", "Entidad", "ID", "Before", "After", "Timestamp"],
      rows.map((row) => [
        row.actor,
        row.action,
        row.entity_type,
        row.entity_id,
        compactJson(row.before_data),
        compactJson(row.after_data),
        date(row.created_at),
      ]),
    ),
  );
}

export function renderError(status: number, message: string): string {
  return layout(
    String(status),
    `<div class="empty"><h2>${status}</h2><p>${escapeHtml(message)}</p></div>`,
  );
}

function layout(title: string, content: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Shopping Admin</title><style>${styles}</style></head>
  <body><header><a class="brand" href="/">Shopping Admin</a><nav><a href="/">Providers</a><a href="/refresh-requests">Refresh queue</a><a href="/sync-runs">Sync runs</a><a href="/catalog">Catálogo</a><a href="/matching">Matching</a><a href="/anomalies">Anomalías</a><a href="/audit">Auditoría</a></nav></header>
  <main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<div class="empty">No hay resultados.</div>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td>${isTrustedCell(cell) ? cell : escapeHtml(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function badge(value: string): string {
  const tone = /ACTIVE|SUCCEEDED|FRESH|ACCEPTED|HIGH/.test(value)
    ? "good"
    : /DEGRADED|PARTIAL|STALE|LOW|PROPOSED/.test(value)
      ? "warn"
      : /FAILED|ERROR|REJECTED|UNAVAILABLE|VERY_STALE|NON_POSITIVE|EXTREME|INCONSISTENT|CONTRACT|PARSING|REPEATED/.test(
            value,
          )
        ? "bad"
        : "neutral";
  return `<span class="badge ${tone}">${escapeHtml(value)}</span>`;
}

function renderRefreshForms(row: ProviderSummary): string {
  if (row.state === "DISABLED") {
    return '<p class="muted">Reactiva el provider para solicitar sincronizaciones.</p>';
  }
  const common = `<input type="hidden" name="retailerId" value="${escapeHtml(row.retailerId)}"><label>CP <input name="postalCode" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required></label>`;
  const price = row.capabilities.includes("PRICE_REFRESH")
    ? `<form class="inline-form" method="post" action="/actions/refresh-request">${common}<input type="hidden" name="requestType" value="PRICE_REFRESH"><label>SKUs opcionales <input name="productIds" placeholder="sku-1, sku-2"></label><button>Price refresh</button></form>`
    : "";
  const catalog = row.capabilities.includes("CATALOG")
    ? `<form class="inline-form" method="post" action="/actions/refresh-request">${common}<input type="hidden" name="requestType" value="CATALOG_SYNC"><button>Catalog sync</button></form>`
    : "";
  return price + catalog;
}

function renderClassificationActions(row: ClassificationView): string {
  const assignment = `<details><summary>Asignar concepto</summary><form method="post" action="/actions/match-reassign"><input type="hidden" name="retailerProductId" value="${escapeHtml(row.retailerProductId)}"><input name="productConceptId" aria-label="UUID del concepto" placeholder="UUID del concepto" required><button>Asignar</button></form></details>`;
  if (row.status === "UNMATCHED") {
    return `<div class="actions">${assignment}</div>`;
  }
  const matchId = escapeHtml(row.id);
  const decisions = `<form method="post" action="/actions/match-accept"><input type="hidden" name="matchId" value="${matchId}"><button>Aceptar</button></form><form method="post" action="/actions/match-reject"><input type="hidden" name="matchId" value="${matchId}"><button class="danger">Rechazar</button></form>`;
  const concept = row.concept;
  const correction =
    concept === null
      ? ""
      : `<details><summary>Corregir concepto</summary><form class="edit-form" method="post" action="/actions/concept-update"><input type="hidden" name="productConceptId" value="${escapeHtml(concept.id)}"><label>Nombre <input name="name" value="${escapeHtml(concept.name)}" required></label><label>Nombre base <input name="base_name" value="${escapeHtml(concept.base_name)}" required></label><label>Categoría <input name="category" value="${escapeHtml(concept.category ?? "")}"></label><label>Aliases <input name="aliases" value="${escapeHtml(concept.aliases.join(", "))}"></label><label>Dimensión <select name="default_dimension">${["COUNT", "MASS", "VOLUME"].map((dimension) => `<option${concept.default_dimension === dimension ? " selected" : ""}>${dimension}</option>`).join("")}</select></label><label>Cantidad por defecto <input name="default_amount" type="number" min="0" step="any" value="${concept.default_amount ?? ""}"></label><label>Unidad <select name="default_unit"><option value="">—</option>${["unit", "g", "kg", "ml", "l"].map((unit) => `<option${concept.default_unit === unit ? " selected" : ""}>${unit}</option>`).join("")}</select></label><label>Selección <select name="selection_policy">${["CHEAPEST_COVERING", "CLOSEST_AMOUNT"].map((policy) => `<option${concept.selection_policy === policy ? " selected" : ""}>${policy}</option>`).join("")}</select></label><button>Guardar concepto</button></form></details>`;
  return `<div class="actions">${decisions}${assignment}${correction}</div>`;
}

function compactJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const serialized = JSON.stringify(value);
  return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
}

function isTrustedCell(value: string): boolean {
  return (
    value.startsWith('<span class="badge') ||
    value.startsWith('<div class="actions">')
  );
}

function date(value: string | null): string {
  return value === null
    ? "—"
    : new Intl.DateTimeFormat("es-ES", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value));
}

function duration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const styles = `
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#18211b;background:#f4f6f2;color-scheme:light}*{box-sizing:border-box}body{margin:0}header{display:flex;align-items:center;gap:2rem;padding:1rem 2rem;background:#18211b;color:white;position:sticky;top:0}header a{color:#dce8de;text-decoration:none}.brand{font-weight:800;color:white;font-size:1.1rem}header nav{display:flex;gap:1rem;flex-wrap:wrap}main{max-width:1500px;margin:auto;padding:2rem}h1{font-size:1.75rem;margin:0 0 1.5rem}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}.card{background:white;border:1px solid #dfe5dc;border-radius:10px;padding:1rem}.card-title{display:flex;justify-content:space-between;gap:1rem}.card dl{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;margin:1rem 0}.card dt{color:#667069}.card dd{margin:0;text-align:right}.error{min-height:2.5rem}.badge{display:inline-block;border-radius:999px;padding:.2rem .55rem;font-size:.72rem;font-weight:800;letter-spacing:.03em}.good{background:#d8f3dc;color:#1b5e2b}.warn{background:#fff0c2;color:#795800}.bad{background:#fbd7d4;color:#8b1d18}.neutral{background:#e8ebe8;color:#4c544e}.table-wrap{overflow:auto;background:white;border:1px solid #dfe5dc;border-radius:10px}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:.75rem;border-bottom:1px solid #edf0eb;white-space:nowrap}th{background:#f8faf7;color:#5d675f;font-size:.75rem;text-transform:uppercase}pre{white-space:pre-wrap;font-size:.75rem;background:#f4f6f2;padding:.75rem;border-radius:6px;max-height:220px;overflow:auto}.filters,.inline-form{display:flex;gap:.6rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem}.filters label,.inline-form label,.edit-form label{display:grid;gap:.3rem;color:#59625c;font-size:.8rem}.filters input,.filters select,.filters button,.inline-form input,.inline-form select,.inline-form button,.actions input,.actions button,.edit-form input,.edit-form button{font:inherit;padding:.55rem .7rem;border:1px solid #bdc6bd;border-radius:6px;background:white}.filters button,.inline-form button,.actions button,.edit-form button{background:#245c35;color:white;border-color:#245c35;cursor:pointer}.tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}.tabs a{padding:.5rem .75rem;border-radius:6px;background:white;border:1px solid #d5dcd3;color:#304238;text-decoration:none}.tabs a[aria-current=page]{background:#245c35;color:white}.actions{display:flex;gap:.4rem;align-items:flex-start}.actions form{display:flex;gap:.35rem}.actions details{min-width:110px}.actions .danger{background:#8b1d18;border-color:#8b1d18}.edit-form{display:grid!important;gap:.4rem;min-width:260px}.empty{padding:3rem;text-align:center;background:white;border:1px solid #dfe5dc;border-radius:10px}.muted{color:#69736c}@media(max-width:700px){header{align-items:flex-start;flex-direction:column;gap:.75rem;padding:1rem}main{padding:1rem}}
`;
