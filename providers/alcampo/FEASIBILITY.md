# AlcampoProvider: viabilidad técnica

## Estado real

**DEGRADED (revalidado el 13 de agosto de 2026).** El provider implementa
`resolveMarket`, `CATALOG`, `getProduct` y `PRICE_REFRESH`. Una sesión Node limpia
puede resolver el mercado 50009 y el flujo completo ha terminado correctamente
en ejecuciones live, pero AWS WAF responde de forma intermitente con un challenge
`202`. Por ello no puede garantizarse un barrido completo de las 3534 categorías.

No se fabrica ni se intenta obtener un token WAF, no se automatiza el challenge
y no se copian cookies o cabeceras sensibles de los HAR.

## Resolución de mercado

El flujo reproducible usa:

1. `GET /` y el `initial-state-script` para obtener contexto de sesión;
2. búsqueda de área por código postal;
3. detalle del área, que ya contiene coordenadas, CP y dirección formateada;
4. creación de `temporary-delivery-destination`;
5. lectura de `delivery-address` y validación de entrega a domicilio;
6. activación de sesión con el destino y la región resueltos.

El antiguo lookup adicional por coordenadas no forma parte del flujo: devolvía
HTTP 400 desde Node y repetía datos que ya proporciona el detalle del área.

## Catálogo y productos

El árbol v1 se parsea en DTOs internos. Las páginas SSR aportan el `ItemList`
autoritativo y el `initial-state-script` relaciona `retailerProductId` con el UUID
interno. Cuando la relación está completa se usa:

```text
PUT /api/webproductpagews/v6/products
```

Los lotes contienen como máximo 24 UUID internos, igual que el tráfico observado.
Para detalle y refresh dirigido se usa:

```text
GET /api/webproductpagews/v5/products/bop?retailerProductId={id}
```

La respuesta v5 se desenvuelve desde `{ product }`. Se admiten IDs numéricos y
alfanuméricos con guiones. Las llamadas `product-pages` de portada y
`cxhub/featured-products` observadas en los HAR son decoración/recomendaciones y
no participan en la ingestión.

## Precios y promociones

Se confirman `REGULAR` y `CATCHWEIGHT`, unidades por pieza, kilogramo, litro y
100 ml, y promociones `OFFER` y `LOYALTY`. Un precio por 100 ml se normaliza a
EUR/l. `promotions: null` equivale a ausencia de promociones. Solo se persiste
`promoPrice` cuando el contrato proporciona un importe exacto.

## Límite operativo

Los parsers y mappers procesan todas las respuestas autoritativas de los HAR y
las pruebas live han confirmado mercado, categoría, producto y refresh. Aun así,
el challenge WAF puede afectar HTML SSR, batches v6 y detalle v5 después de varias
peticiones. El estado debe permanecer `DEGRADED`; un resultado live aislado no
convierte el catálogo completo en una capacidad garantizada.
