# EroskiProvider: contrato operativo

## Estado

**DEGRADED con `SEARCH`, `CATALOG` y `PRICE_REFRESH` (confirmado el 13 de
agosto de 2026).** Eroski no permite seleccionar una tienda sin código postal,
pero una sesión anónima de la web asigna de forma reproducible la tienda pública
de alimentación `157` (`Bilbondo`). El provider usa esa tienda para cualquier
código postal y declara `pricesMayVaryByLocation: true`; por ello la interfaz
debe avisar de que los precios pueden no ser precisos para la ubicación del grupo.

## Sesión y mercado

El flujo parte siempre de una sesión limpia:

```text
GET https://supermercado.eroski.es/
```

La respuesta pública establece `JSESSIONID`, `supermarket.ali.shop=157` y
`supermarket.ali.shopName=Bilbondo`. No se reutilizan cookies de navegador,
credenciales, tokens ni datos de los HAR. El provider conserva las cookies solo
en memoria durante su propia instancia y crea el mercado `shop-ref:157`.

## Catálogo y búsqueda

La navegación HTML contiene el árbol completo. Se publican las categorías de
segundo nivel de los departamentos de supermercado; las secciones destacadas de
electrónica, electrohogar y descanso quedan fuera. Cada categoría conserva su
ruta confirmada y su paginación incluye las subcategorías mostradas como filtros.

La primera página de productos está en el documento HTML. Las siguientes usan
el mismo contrato Tapestry observado en los HAR:

```text
POST /es/supermarket:loadpage?t:ac={ruta-de-categoria}
t:zoneid=productListZone&pageNumber={n}
```

Se recorre hasta recibir una página vacía y se aplica un máximo defensivo de 100
páginas. Las tarjetas aportan ID, nombre, marca, URL, imagen, precio actual,
precio anterior, precio por unidad, promoción, categoría y formatos de peso
variable. El precio visible debe coincidir con `data-metrics`; una divergencia
se trata como cambio de contrato.

La búsqueda pública usa el documento
`GET /es/search/results/?q={consulta}` y devuelve su primera página, igual que el
contrato `SearchRetailerProvider` del resto del proyecto. No se usa el endpoint
de sugerencias con `t:formdata` opaco.

## Detalle y refresh

Eroski resuelve cualquier ID numérico con una ruta estable, sin conocer el slug:

```text
GET /es/productdetail/{id}-x/
```

El servidor devuelve el producto correspondiente y permite refrescar por ID de
forma directa. Se extraen precio normal/promocional, precio por unidad,
disponibilidad, peso variable e identidad. Las respuestas 404, 429, de contrato
incompatible y de red se traducen a los errores tipados comunes.

## Límites

- El mercado no representa el código postal solicitado: siempre es la tienda
  pública `157`. Esta es la razón de mantener el estado `DEGRADED` y del aviso UI.
- No se ha observado un producto agotado en los HAR; el parser reconoce textos
  de no disponibilidad y, para detalle, exige el control público de añadir.
- No se automatiza login, no se guardan credenciales y no se intenta eludir WAF,
  CAPTCHA ni controles anti-bot.
- El test live es opcional y se activa con `RUN_LIVE_PROVIDER_TESTS=true`.
