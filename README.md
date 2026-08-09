# shopping-app

Monorepo TypeScript para los componentes compartidos y proveedores de `shopping-app`.
Este repositorio contiene únicamente la estructura y el tooling iniciales; todavía no
incluye todavía una aplicación móvil. El backend PostgreSQL se ejecuta localmente
mediante Supabase y los providers viven como módulos independientes.

## Estructura

```text
apps/                       Futuras aplicaciones.
packages/
  domain/                   Tipos de dominio compartidos.
  ingestion/                Pipeline genérico RetailerProvider -> Supabase.
  retailer-contracts/       Contratos y errores para proveedores.
  product-normalization/    Futura normalización de productos.
  voice-parser/             Futuro análisis de entradas de voz.
providers/
  dia/                      Provider de DIA (detalle provisional vía analytics).
  mercadona/                Provider de catálogo de Mercadona por warehouse.
  alcampo/                  Futuro proveedor de Alcampo.
  eroski/                   Futuro proveedor de Eroski.
tooling/
  ingest/                   CLI de ingestión persistente y dry-run.
  provider-poc/             CLI de prueba con providers mock.
supabase/                   Configuración, migraciones y seeds de PostgreSQL.
```

Los workspaces se declaran en `pnpm-workspace.yaml`. Todos los módulos TypeScript
extienden `tsconfig.base.json`, que activa el modo estricto y comprobaciones
adicionales comunes.

## Comandos

Requiere Node.js y pnpm. Desde la raíz del repositorio:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm provider-poc --provider dia --postal-code 50009 --query "leche"
```

La ingesta persistente requiere credenciales backend de Supabase en
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`:

```bash
pnpm ingest --provider dia --postal-code 50009 --query "leche"
pnpm ingest --provider dia --postal-code 50009 --query "leche" --dry-run
pnpm ingest refresh --provider dia --postal-code 50009
pnpm ingest refresh --provider dia --postal-code 50009 --dry-run
pnpm ingest refresh --provider dia --postal-code 50009 --product-id 261354
```

El dry-run de SEARCH no necesita credenciales de base de datos. El dry-run de
PRICE_REFRESH sí las necesita para seleccionar productos conocidos, aunque no
crea sync runs ni llama a `refreshPrices`.

El refresh selecciona productos conocidos presentes en intents sin completar,
ofertas stale/very-stale o IDs manuales. Por defecto una oferta pasa a `STALE` a
las 6 horas y a `VERY_STALE` a las 24 horas; ambos umbrales son configurables en
`PriceRefreshPipelineOptions`. El modelo admite `lastUsedAt`, pero la consulta SQL
actual lo deja vacío porque todavía no existe una fuente fiable de eventos de uso
o compra.

Mercadona permanece deshabilitado para `--query`: su provider no tiene una
capability de búsqueda textual confirmada. El registro del CLI lo rechaza antes
de acceder a Supabase. Su futura ingesta debe usar el catálogo por categorías.

## Supabase local

Requiere Docker Desktop en ejecución. El CLI está instalado como devDependency
con versión fija, por lo que todos los comandos se ejecutan mediante pnpm:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:test
pnpm supabase:types
pnpm supabase:stop
```

`pnpm supabase:reset` recrea PostgreSQL desde `supabase/migrations` y carga los
retailers base definidos en `supabase/seed.sql`. PostgreSQL es la fuente de verdad;
los tipos de `packages/database` se regeneran desde el esquema local, no se editan
manualmente.

Anonymous Auth está habilitado: sus sesiones usan el rol PostgreSQL
`authenticated` y quedan sometidas a las mismas políticas RLS que cualquier otra
sesión autenticada. La creación de grupos y sus invitaciones se realiza únicamente
mediante las RPC `create_group_with_initial_list`, `generate_group_invite` y
`join_group_by_invite`. Los códigos de invitación se devuelven una sola vez y la
base de datos conserva únicamente su hash en un esquema privado.

Las tablas de grupos, listas e items son privadas para sus miembros. El catálogo y
los precios permiten lectura autenticada, mientras que su escritura y las tablas
operativas de providers quedan reservadas al rol backend `service_role`.

- `typecheck` comprueba todos los módulos TypeScript.
- `lint` ejecuta ESLint sobre packages, providers y tooling.
- `test` ejecuta Vitest una vez para todo el monorepo.
- `format` aplica Prettier a los archivos compatibles.
- `provider-poc` usa los providers reales para DIA y Mercadona, y providers mock
  para el resto.

El CLI también admite consultar un producto concreto:

```bash
pnpm provider-poc --provider dia --postal-code 50009 --product 261354
```

Mercadona está orientado a ingestión de catálogo y admite listar categorías,
obtener productos/ofertas por categoría y consultar detalle/precio de producto:

```bash
pnpm provider-poc --provider mercadona --postal-code 50009 --categories
pnpm provider-poc --provider mercadona --postal-code 50009 --category 72
pnpm provider-poc --provider mercadona --postal-code 50009 --product 10382
```

`MercadonaProvider` implementa `CatalogRetailerProvider`, pero no
`SearchRetailerProvider`: no se ha confirmado un endpoint remoto de búsqueda
textual. El flujo previsto es categorías/productos → ingestión → PostgreSQL, sin
consultas live desde la aplicación móvil. El mercado usa como identidad inmutable
el warehouse devuelto al resolver el código postal.

La navegación de catálogo se modela mediante la capability opcional y genérica
`CatalogRetailerProvider`. Un consumidor puede detectarla con
`supportsCatalog(provider)` y trabajar con `RetailerCategory`, sin importar el
provider concreto ni comprobar el retailer.

La búsqueda común devuelve productos y ofertas como colecciones separadas. DIA
las obtiene en la misma petición de la primera página. Para procesos que necesiten
paginación, `DiaProvider.searchProductsPage(query, market, page)` expone además
los metadatos de página.

Los tests live están desactivados por defecto. El caso conocido de DIA se activa
explícitamente con `RUN_LIVE_PROVIDER_TESTS=true`:

```bash
RUN_LIVE_PROVIDER_TESTS=true pnpm test providers/dia/src/dia-provider.live.test.ts
RUN_LIVE_PROVIDER_TESTS=true pnpm test providers/mercadona/src/mercadona-provider.live.test.ts
```

## Añadir un package

1. Crea una carpeta en `packages/<nombre>` (o en `providers/<nombre>` si es un
   proveedor).
2. Añade un `package.json` con un nombre único bajo el scope `@shopping-app`.
3. Añade un `tsconfig.json` que extienda `../../tsconfig.base.json`.
4. Crea `src/index.ts` como punto de entrada.
5. Ejecuta `pnpm install` si añadiste dependencias y valida con `pnpm typecheck`,
   `pnpm lint` y `pnpm test`.

## Tests

Los tests pueden colocarse junto al código usando los sufijos `.test.ts` o
`.spec.ts`. Ejecuta toda la suite con:

```bash
pnpm test
```
