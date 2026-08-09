# EroskiProvider: viabilidad técnica

## Estado recomendado

**DEGRADED (parcial).** Se ha confirmado que una página pública de detalle de
producto puede obtenerse por `GET` y devuelve HTML renderizado en servidor. El
provider parsea ese HTML de forma defensiva, pero no declara disponibles la
resolución de mercado ni la búsqueda.

## Capacidad operativa confirmada

La implementación solo usa páginas públicas de esta familia:

```text
GET https://supermercado.eroski.es/es/productdetail/{id}-{slug}/
```

La URL completa y canónica debe conocerse de antemano. No se presupone que una
URL construida solo con el identificador funcione, por lo que el provider usa un
registro explícito `productUrls`. El producto `18631259` se incluye porque su URL
canónica fue confirmada mediante un HAR real.

`EroskiHttpClient` acepta únicamente el origen configurado y rutas de
`productdetail`, solicita HTML y no ejecuta JavaScript. `EroskiHtmlParser` usa un
parser DOM (`cheerio`), selectores semánticos y JSON-LD como fallback. Las
expresiones regulares se limitan a valores de campo ya extraídos (cantidades,
unidades y marcadores textuales); no se usan para parsear el documento completo.

## Campos y separación de dominio

Cuando existen, el DTO interno conserva `externalId`, `name`, `brand`, `price`,
`unitPrice`, `format`, `weight`, `shopRef`, `image` y `availability`.

- `EroskiMapper.toProduct` genera un `RetailerProduct` sin precios.
- `EroskiMapper.toOffer` genera el `ProductOffer` con precio, precio por unidad y
  disponibilidad.
- El `shopRef` observado se compara con el mercado suministrado. Se acepta como
  `Market.externalId` el propio valor o `shop-ref:{valor}`, y también puede
  declararse como `Market.metadata.shopRef`. Una discrepancia se rechaza para no
  asociar precios a una tienda incorrecta.

Un `shopRef` visible en una página pública identifica el contexto observado, pero
no demuestra qué código postal o tienda física representa.

## Detección de cambios

Se consideran obligatorios para una observación de precio segura:
`externalId`, `name`, `price`, `shopRef` y `availability`. Si desaparecen, si hay
varios `shopRef` incompatibles o si el identificador no coincide con el solicitado,
el provider emite `ProviderContractChangedError`. Respuestas vacías o con un
`Content-Type` distinto de HTML también se tratan como cambio de contrato.

Los fixtures están sanitizados: no contienen cookies, tokens, credenciales ni
datos de sesión.

## Capacidades pendientes

- `resolveMarket`: lanza siempre `ProviderCapabilityUnavailableError`; no existe
  un flujo confirmado y reproducible para elegir tienda mediante código postal.
- `searchProducts`: no hay contrato público confirmado.
- Resolución general de un identificador a su slug/URL canónica.
- Un endpoint JSON equivalente a la página SSR.
- Confirmar la estabilidad de selectores y datos semánticos en más categorías,
  productos agotados, promociones y formatos por unidad.
- Relacionar de forma verificable `shopRef`, tienda, código postal y precios.

## Límites operativos

No se automatiza login, no se guardan credenciales, no se usa Playwright,
Selenium ni un navegador controlado, y no se intenta sortear CAPTCHA, WAF u otros
controles anti-bot. El test live es opcional y solo se activa con
`RUN_LIVE_PROVIDER_TESTS=true`.

## Condiciones para ampliar el provider

1. Confirmar un mecanismo autorizado y reproducible de selección de mercado.
2. Confirmar cómo obtener de forma general la URL canónica de un producto.
3. Añadir fixtures reales sanitizados de varias estructuras y estados de stock.
4. Ejecutar observaciones live periódicas que permitan medir estabilidad antes de
   declarar nuevas capacidades como operativas.
