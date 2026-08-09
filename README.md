# shopping-app

Monorepo TypeScript para los componentes compartidos y proveedores de `shopping-app`.
Este repositorio contiene únicamente la estructura y el tooling iniciales; todavía no
incluye una aplicación móvil, Supabase ni integraciones reales con supermercados.

## Estructura

```text
apps/                       Futuras aplicaciones.
packages/
  domain/                   Tipos de dominio compartidos.
  retailer-contracts/       Contratos y errores para proveedores.
  product-normalization/    Futura normalización de productos.
  voice-parser/             Futuro análisis de entradas de voz.
providers/
  dia/                      Provider de DIA (detalle provisional vía analytics).
  mercadona/                Provider de catálogo de Mercadona por warehouse.
  alcampo/                  Futuro proveedor de Alcampo.
  eroski/                   Futuro proveedor de Eroski.
tooling/
  provider-poc/             CLI de prueba con providers mock.
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

`MercadonaProvider.searchProducts` lanza
`ProviderCapabilityUnavailableError`: no se ha confirmado un endpoint remoto de
búsqueda textual. El flujo previsto es categorías/productos → ingestión →
PostgreSQL, sin consultas live desde la aplicación móvil. El mercado usa como
identidad inmutable el warehouse devuelto al resolver el código postal.

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
