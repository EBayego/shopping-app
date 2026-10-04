# Auditoría de ingesta y providers

Fecha: 4 de octubre de 2026. Código postal de las comprobaciones: `50009`.

Se revisaron los scripts de `tooling/ingest`, los pipelines y la persistencia de
`packages/ingestion`, los cuatro providers y los logs del scheduler. Se navegaron
las webs con una instancia aislada de Chrome, inspeccionando las peticiones de
red, el HTML y los módulos públicos del frontend. El navegador integrado de
Codex se volvió a intentar, pero su herramienta falló antes de abrir una página
con `apply deny-read ACLs`; no fue un error de las webs.

Las comprobaciones crearon únicamente sesiones anónimas de los supermercados.
No se ejecutó el scheduler contra Supabase ni se modificaron datos remotos.
Los resultados describen el acceso observado desde este equipo, no garantizan
que una IP de GitHub Actions reciba las mismas respuestas.

## Flujo de los scripts

- `pnpm ingest:scheduler`: despacha trabajos vencidos en Supabase y consume la
  cola. Crea un provider nuevo por trabajo. El workflow actual aporta un tick
  diario; Supabase conserva cadencias, locks, leases y reintentos.
- `CATALOG_SYNC`: resuelve mercado, obtiene categorías y recorre los productos;
  persiste en lotes de 100 con deduplicación. La descarga de catálogo usa dos
  operaciones de categoría concurrentes por defecto.
- `PRICE_REFRESH`: resuelve mercado, lista candidatos de Supabase y aplica la
  política de frescura y uso en listas. Refresca un SKU por operación, con dos
  operaciones concurrentes por defecto. Conserva los éxitos de una ejecución
  parcial; solo retira productos con un `404` tipado como producto inexistente.
- El worker considera una ejecución parcial fallida a efectos de reprogramación;
  no la presenta como un refresh completo. Los fallos previos a abrir un run ahora
  también emiten el evento `ingestion.preflight_failed`.
- `pnpm provider-poc`: consulta providers sin persistir. Eroski antes caía en el
  mock genérico; ahora reutiliza `EroskiProvider`. El registry del scheduler ya
  utilizaba el provider real y no tenía ese error.

## Endpoints y datos por provider

### Mercadona

Origen: [tienda.mercadona.es](https://tienda.mercadona.es/).

| Operación | Petición                                                   | Contexto/datos                                          |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Mercado   | `PUT /api/postal-codes/actions/change-pc/?lang=es&wh=vlc1` | JSON `new_postal_code`; se conserva el almacén resuelto |
| Árbol     | `GET /api/categories/?lang=es&wh={warehouse}`              | Categorías actuales del almacén                         |
| Categoría | `GET /api/categories/{id}/?lang=es&wh={warehouse}`         | Grupos de productos y precios                           |
| Refresh   | `GET /api/products/{id}/?lang=es&wh={warehouse}`           | Ficha actual del SKU                                    |

La navegación confirmó el cambio de `50009` al almacén `4491` y las consultas
de categorías con ese almacén. Los parámetros `lang` y `wh` de la tabla reflejan
las URLs del navegador. El cliente del repositorio usa esas rutas sin query y
envía el contexto en los headers `x-customer-pc` y `x-customer-wh`; su suite live
confirmó que esa variante funciona. El catálogo aprovecha los precios del listado en vez de
consultar cada ficha por separado. No se ha confirmado una búsqueda textual
remota; el provider permanece degradado por esa limitación de capability.

El fallo de memoria mencionado ocurrió mientras el job de Mercadona listaba
candidatos de **Supabase**, en `list_price_refresh_candidates`. El `Range` era
de esa RPC POST, no del catálogo externo de Mercadona. Los cambios que ya
estaban pendientes sustituyen ese header por `limit=1000&offset=...` y detienen
la lectura ante IDs repetidos. Se han conservado sin modificarlos y sus tests
han pasado dentro de la suite completa.

### DIA

Origen: [dia.es](https://www.dia.es/).

| Operación     | Petición                                                                                     | Contexto/datos                                                                 |
| ------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Mercado       | `PUT /api/v1/common-aggregator/save-shipping-address?new_postal_code={cp}&skip_dry_run=true` | Body `null`; `cart_id` y sesión inicial; respuesta `204` con sesión definitiva |
| Árbol         | `GET /api/v1/common-aggregator/menu-data`                                                    | Enlaces e IDs de categorías `L...`                                             |
| Catálogo      | `GET /api/v1/plp-back/reduced{categoryLink}`                                                 | `plp_items` y paginación; siguientes páginas mediante `/pag-{n}/c/{id}`        |
| Búsqueda      | `GET /api/v1/search-back/search/reduced?q={query}&page={n}`                                  | `search_items`, stock y precios                                                |
| Ficha/refresh | `GET /api/v1/pdp-back/{sku}`                                                                 | `product.primary_info`, `prices`, `units_in_stock`, imágenes y categorías      |

El contexto conserva el `session_id` definitivo tanto en el header como en la
cookie, además de `cart_id`. La identidad persistida del mercado continúa
siendo `postal-code:{cp}`. La paginación de catálogo verifica el ID, la página,
los totales y la cantidad final de SKUs únicos.

Se confirmó en los módulos públicos de la ficha que el frontend utiliza
`pdp-back/{sku}`. Se comprobó su respuesta con la sesión resuelta para `50009`,
tanto con el parámetro `path` del frontend como sin él. El navegador recibió
un `403` en una visita a la portada; las llamadas HTTP desde Node y las pruebas
live del provider sí funcionaron. Esta diferencia no demuestra por sí sola
una causa geográfica ni permite atribuir el fallo del scheduler a un endpoint
incorrecto.

**Corrección:** `getProduct` y `refreshPrices` utilizaban
`pdp-insight/initial_analytics/{sku}`. Ese payload solo aportaba precio y un
booleano de stock, y el mapper fijaba `requiresMembership=false`. Se ha cambiado
al endpoint de ficha confirmado, reutilizando el mapper de catálogo/búsqueda.
Por ejemplo, la respuesta observada del SKU `130063P6` tenía precio Club
`5,34 €`, precio anterior `5,64 €`, `0,89 €/L` y stock `30`: ahora se conservan
esas condiciones. Son valores de la muestra, no precios garantizados futuros.
Una ficha con SKU distinto, precio ausente o stock incompatible produce un
error de contrato. El cliente/parser de analítica se conserva para no eliminar
funcionalidad ajena al cambio. La advertencia de salud sobre el endpoint
provisional se ha retirado; `healthCheck` sigue siendo declarativo y no realiza
una sonda de conectividad.

### Alcampo

Origen: [compraonline.alcampo.es](https://www.compraonline.alcampo.es/).

| Operación       | Petición                                                                   | Contexto/datos                                                      |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Bootstrap       | `GET /`                                                                    | Cookies, visitante, CSRF y versión desde `window.__INITIAL_STATE__` |
| Buscar CP       | `PUT /api/address/v1/addresses/areas`                                      | Formulario `query={cp}`                                             |
| Dirección       | `GET /api/address/v1/addresses/areas/{areaId}`                             | CP y coordenadas verificadas                                        |
| Destino anónimo | `POST /api/ecomdeliverydestinations/v2/temporary-delivery-destinations`    | Visitante, coordenadas y dirección obtenidos de la API              |
| Disponibilidad  | `GET /api/ecomdeliverydestinations/v4/delivery-addresses/{id}`             | Región, CP, `DELIVERABLE`, `HOME_DELIVERY`                          |
| Activar mercado | `PUT /api/customersessions/v2/sessions/active`                             | Destino y región resueltos                                          |
| Árbol           | `GET /api/webproductpagews/v1/categories?decoration=false&categoryDepth=4` | Categorías actuales                                                 |
| Listado SSR     | `GET /categories/{parentSlug}/{categorySlug}/{id}`                         | IDs de productos en el estado inicial                               |
| Ficha/refresh   | `GET /api/webproductpagews/v5/products/bop?retailerProductId={sku}`        | SKU comercial, precio y disponibilidad                              |
| Datos en lotes  | `PUT /api/webproductpagews/v6/products`                                    | Array de UUIDs internos de producto                                 |

La navegación mostró consultas de direcciones y lotes `v6/products`; el flujo
de CP del cliente se comprobó mediante llamadas reales. No se han añadido
coordenadas ni IDs de región fijos. La web también dispone de un flujo de
direcciones por coordenadas; no es necesario sustituir el flujo de CP que ya
devuelve región y disponibilidad válidas.

**Corrección de catálogo:** en la categoría de leche `OC1603`, el `ItemList`
y `productEntities` solo contenían 50 productos. Sin embargo,
`data.products.catalogue.data.productGroups` contenía 243 UUIDs únicos y
`totalProducts=243`. El código anterior importaba los primeros 50 y podía
declarar completo un catálogo incompleto. Ahora lee todos los grupos, deduplica
los IDs y utiliza la API existente de lotes, con 24 UUIDs por petición.
Valida total e identidades de la respuesta y conserva la ruta anterior para
HTML que no incluya grupos. La regresión prueba un listado con 50 entidades
visibles y 243 productos reales. La concurrencia interna por defecto baja de
6 a 2 para limitar la presión de las subpeticiones de catálogo.

**Bloqueo observado:** algunas peticiones válidas reciben `HTTP 202` con
`x-amzn-waf-action: challenge`; otras llegan a responder `403`. El SKU `16542`,
que fallaba en el scheduler, sí respondió con datos válidos en una comprobación
directa. Por tanto, esa incidencia no equivale a producto inexistente. Los
errores públicos del provider ahora conservan la explicación del WAF o el
estado HTTP en lugar de atribuir cualquier `403` a ausencia de CSRF.
No se ha implementado ningún mecanismo para eludir el challenge.

### Eroski

Origen: [supermercado.eroski.es](https://supermercado.eroski.es/).

| Operación       | Petición                                                     | Contexto/datos                                                                |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Mercado público | `GET /`                                                      | Cookies `supermarket.ali.shop` y `supermarket.ali.shopName`                   |
| Catálogo        | `GET /es/supermercado/{categoryPath}`                        | Navegación y primer bloque de HTML                                            |
| Paginación      | `POST /es/supermarket:loadpage?t:ac={categoryActionContext}` | Formulario `t:zoneid=productListZone&pageNumber={n}`; JSON con HTML `content` |
| Búsqueda        | `GET /es/search/results/?q={query}`                          | Primer listado HTML de búsqueda                                               |
| Ficha/refresh   | `GET /es/productdetail/{sku}-x/`                             | HTML de producto y datos de oferta                                            |

La web y sus inicializadores Tapestry confirman el endpoint, el contexto de
categoría y el cuerpo de paginación. El provider conserva las cookies, separa
el contexto de cada recorrido y valida que los productos pertenecen a la tienda
seleccionada. Recorre páginas hasta obtener un bloque vacío, con un máximo de
100 páginas adicionales.

**Limitación de mercado:** la sesión pública seleccionó la tienda `157`
(`Bilbondo`). El código postal solicitado no selecciona una tienda Eroski:
se etiqueta la consulta con el CP, pero el mercado persistido es `shop-ref:157`.
La metadata ya indica `marketResolution=public-default` y
`pricesMayVaryByLocation=true`; el provider continúa degradado. No debe
interpretarse como un precio local confirmado para Zaragoza. Para obtenerlo
hay que confirmar un flujo de selección de tienda/dirección; no se ha inventado
un endpoint para esa capability.

**Corrección de reintentos:** timeouts, fallos de red, `408`, `425` y `5xx`
durante bootstrap antes se envolvían como `MarketResolutionError`, que el
executor no reintenta. Ahora conservan `ProviderUnavailableError`. Los errores
permanentes o la ausencia de cookies de tienda siguen siendo fallos de mercado;
`429` conserva el tratamiento de rate limit.

## Fallos del scheduler y cortacircuitos

La [ejecución del 4 de octubre](https://github.com/EBayego/shopping-app/actions/runs/37193467485)
mostró fallos de resolución de DIA sin detalle de transporte, Alcampo con
289 productos intentados y solo 8 actualizados, y después el OOM del job de
Mercadona. La ejecución terminó antes de proporcionar una validación útil de
Eroski. El runner de esa ejecución era Ubuntu/Node 22 en infraestructura Azure
de Estados Unidos; esto es un dato del entorno, no una causa demostrada.

El cortacircuitos sumaba cada intento transitorio como un fallo. Con umbral 5
y tres intentos por operación podía abrirse antes de agotar los reintentos de
unos pocos productos y rechazar en cascada las operaciones en cola. Ahora suma
**operaciones que han agotado sus intentos**, y una operación recuperada no
consume el umbral. Se mantiene el límite de cinco fallos y la apertura temporal:
un proveedor persistentemente bloqueado seguirá deteniendo peticiones.

Se han añadido campos seguros `httpStatus`, `transportKind` y `networkCode` a
los errores estructurados, buscando en causas anidadas y errores agregados de
Node con un límite de recorrido. No se serializan mensajes de causas, cookies,
headers, URLs ni cuerpos de respuesta. El worker conserva estos diagnósticos
en el error saneado del preflight. Esto permite distinguir un `403`, un timeout
y un `ECONNRESET` en la siguiente ejecución de CI.

## Validación y puntos pendientes

- `pnpm test`: **69 archivos y 464 tests pasan**. Incluye los tests existentes
  de la corrección pendiente de paginación de Supabase. Hay avisos preexistentes
  de deprecación de `react-test-renderer`.
- `pnpm lint` y `pnpm typecheck`: pasan.
- `RUN_LIVE_PROVIDER_TESTS=true pnpm test:live`: la primera comprobación pasó
  9/9; una comprobación posterior pasó 7/9 y ambas pruebas de Alcampo fallaron
  por `HTTP 202`/AWS WAF, durante ficha y resolución de mercado. En esa segunda
  ejecución la consulta de catálogo de Alcampo finalizó antes del fallo de ficha.
- Tras sustituir el endpoint de DIA, su suite live se repitió y pasó **3/3**:
  mercado/producto/refresh, búsqueda y catálogo.
- `pnpm provider-poc --provider eroski --postal-code 50009 --query leche`:
  pasó contra la web real y confirmó el mercado público `shop-ref:157`.
- El workflow manual `provider-live-tests.yml` ahora permite elegir Alcampo,
  además de los otros tres providers.

Pendiente de comprobar después de subir estos cambios: ejecutar las suites
live desde el runner de GitHub y revisar los nuevos diagnósticos de mercado.
El acceso estable de Alcampo sigue sin resolverse: la reducción de concurrencia
y el arreglo del cortacircuitos no garantizan superar un WAF persistente.
No se ha hecho push ni se ha disparado una ingesta remota en esta revisión.

Optimizaciones adicionales identificadas, sin alterar todavía esos contratos:

1. Unificar el presupuesto de reintentos: Mercadona y Alcampo reintentan en el
   cliente HTTP y también en el executor. Una operación puede llegar a nueve
   peticiones HTTP si ambas capas agotan sus tres intentos.
2. Procesar candidatos y persistir precios por bloques: el refresh sigue
   acumulando candidatos y promesas de todos los seleccionados. La corrección
   existente evita la repetición infinita, pero un catálogo muy grande aún
   necesita memoria proporcional al número de candidatos.
3. Extender el timeout a la lectura del cuerpo: los clientes liberan el timer
   al recibir los headers y después leen JSON/HTML; un cuerpo que se detenga
   puede exceder el plazo configurado.
4. En Eroski, añadir detección temprana de páginas sin IDs nuevos y confirmar la
   paginación de búsqueda. El catálogo tiene un máximo finito, pero actualmente
   la búsqueda solo consulta el primer listado.
