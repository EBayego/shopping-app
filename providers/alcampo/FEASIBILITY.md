# AlcampoProvider: viabilidad técnica

## Estado real

**DEGRADED (validado el 10 de agosto de 2026).** El provider implementa
`resolveMarket`, `CATALOG`, `getProduct` y `PRICE_REFRESH`. Una sesión Node limpia
ya puede hacer bootstrap y resolver el mercado 50009 hasta activar la sesión, sin
copiar CSRF, visitor, cookies ni identificadores del HAR.

El recorrido completo todavía no puede declararse `ACTIVE`: el GET de la página
SSR canónica de OC1603 responde desde Node con `202 Accepted`, cuerpo vacío y la
cabecera `x-amzn-waf-action: challenge`. Los endpoints individuales de producto
también pueden quedar bloqueados por CloudFront sin un contexto WAF legítimo. El
provider detecta esa respuesta como indisponibilidad; no fabrica
`aws-waf-token`, no automatiza el challenge, no usa navegador, CAPTCHA ni proxy.

Se conserva soporte para inyectar un `AlcampoSessionContext` legítimo, incluido
un token WAF obtenido por medios autorizados. Ningún token o cookie real del HAR
está incluido en código, fixtures o logs.

## Resolución de mercado

El HAR completo confirmó este flujo y sus contratos:

1. `GET /` y lectura del `initial-state-script`, que proporciona `visitorId`,
   CSRF y versión del asset, además de las cookies normales emitidas por servidor;
2. búsqueda de área por código postal;
3. detalle del área;
4. lookup por coordenadas;
5. creación de `temporary-delivery-destination`;
6. lectura de `delivery-address` y validación `DELIVERABLE` + `HOME_DELIVERY`;
7. activación de sesión con `deliveryDestinationId` y `resolvedRegionId`.

El geocodificador devuelve actualmente HTTP 400 desde Node. En ese caso se
reutilizan exactamente las coordenadas, CP y dirección formateada ya devueltos por
el detalle de área, tal como permite el contrato; no se inventa una dirección.
Con ese fallback confirmado por ejecución real, `resolveMarket("50009")` termina
y devuelve un `Market` inmutable cuyo `externalId` es el `resolvedRegionId`.

`deliveryDestinationId`, `visitorId`, `cartId`, CSRF y cookies son sólo contexto
temporal. La identidad persistente del mercado nunca cambia tras catálogo,
producto o refresh.

## Catálogo y batching

El árbol v1 se parsea en DTOs internos. Se enumeran categorías hoja apropiadas
para ingestión y se conservan rutas de páginas SSR también para nodos ingestibles
no hoja, como la categoría confirmada `OC1603` (Leche).

La ruta SSR conserva los slugs Unicode canónicos. El HTML se procesa con
`cheerio`, localizando exactamente:

```css
script[data-test="product-listing-structured-data"][type="application/ld+json"]
```

El `ItemList` completo es la fuente autoritativa de pertenencia. Se validan URLs,
IDs numéricos y duplicados. El `initial-state-script` confirmado contiene
`data.products.productEntities`, que permite relacionar cada
`retailerProductId` con su UUID interno. Cuando la relación está completa se usa
`PUT /api/webproductpagews/v6/products` en lotes de 24; si no lo está, se usa el
endpoint individual v5 con concurrencia limitada. Una prueba contractual cubre
50 productos repartidos en más de un lote.

Actualmente el challenge WAF impide descargar ese HTML desde una sesión Node
limpia, por lo que el catálogo real no puede recorrerse desde cero aunque el
parser y el batching estén implementados y cubiertos por fixtures sanitizados.

## Producto, precios, CATCHWEIGHT y promociones

`getProduct` acepta el `retailerProductId` numérico y usa el contexto del mercado.
`refreshPrices` consulta sólo los IDs pedidos, produce un `observedAt` real y
admite fallos parciales sin presentar datos antiguos como observaciones nuevas.

El mapper separa `RetailerProduct` de `ProductOffer`, incluyendo formatos,
multipacks, imágenes, URLs, disponibilidad y precios por unidad. Los productos
`CATCHWEIGHT` conservan mínimo, típico, máximo, `variableWeight=true` y EUR/kg;
el precio estimado para el peso típico no se trata como precio fijo universal.

Las promociones conservan identificadores, descripción y tipo. Sólo existe
`promoPrice` cuando la respuesta proporciona un importe exacto; nunca se deduce
un descuento a partir del texto. La pertenencia requerida se conserva únicamente
cuando está indicada por el contrato.

## Resiliencia, capacidades y límite operativo

El cliente aplica timeout con `AbortController`, retries sólo para fallos
transitorios, `Retry-After`, backoff con jitter, límite de concurrencia, parsing
defensivo y errores tipados. Los logs de diagnóstico live ocultan UUIDs y valores
largos y sólo muestran nombres de cookies/cabeceras.

Alcampo declara `CATALOG` y `PRICE_REFRESH`, no `SEARCH`. El registro y el seed
permanecen `DEGRADED` hasta que una ejecución Node limpia complete:

`bootstrap → resolveMarket → OC1603 SSR → getProduct(54180) → refreshPrices`

sin resolver ni eludir el challenge AWS WAF y sin contexto copiado de navegador.
