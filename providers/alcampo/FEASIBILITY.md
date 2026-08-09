# AlcampoProvider: viabilidad técnica

## Estado recomendado

**DEGRADED (experimental).** El contrato de detalle de producto puede parsearse y
mapearse de forma determinista a partir de fixtures, pero las capacidades live no
son reproducibles sin un contexto legítimo procedente de una sesión de navegador.
Sin ese contexto, el provider informa estado `unavailable` y no realiza requests.

## Endpoint confirmado

Sólo se considera confirmado:

```text
GET https://www.compraonline.alcampo.es/api/webproductpagews/v5/products/bop?retailerProductId={id}
```

No se implementan ni se presuponen endpoints de búsqueda, catálogo, creación de
sesión, selección de tienda o resolución de código postal.

## Información confirmada

Una respuesta válida contiene `productId`, `retailerProductId`, `type`, `name`,
`brand`, `packSizeDescription`, `price`, `unitPrice`, `available`, `catchweight`,
`categoryPath`, `images` y `promotions`. El caso observado `70212` es
`CATCHWEIGHT`, con peso mínimo/típico/máximo aproximado de 300/400/500 g. El
fixture conserva el ejemplo observado de 4,78 EUR y 11,95 EUR/kg y no contiene
cookies ni tokens. Imágenes y promociones se conservan como datos externos sin
interpretar porque no se ha confirmado el contrato de sus elementos.

## HTTP 403 y contexto de sesión

Una petición HTTP mínima fuera del navegador devuelve HTTP 403. La petición que
sí funciona dentro del navegador incluye, entre otro contexto, las cookies
`global_sid` y `aws-waf-token` y la cabecera `x-csrf-token`.

El provider no obtiene, fabrica, renueva ni rota esos valores. No automatiza
challenges, CAPTCHA ni ningún mecanismo de AWS WAF. Sólo permite una request live
si el consumidor proporciona explícitamente un `AlcampoSessionContext`, o si
están presentes todas estas variables de entorno:

- `ALCAMPO_GLOBAL_SID`
- `ALCAMPO_AWS_WAF_TOKEN`
- `ALCAMPO_CSRF_TOKEN`
- `ALCAMPO_MARKET_ID`
- `ALCAMPO_POSTAL_CODE`

`ALCAMPO_MARKET_ID` y `ALCAMPO_POSTAL_CODE` identifican el mercado ya seleccionado
por el contexto legítimo; no implican que el provider sepa seleccionar una tienda.
Los secretos no se registran, persisten ni incluyen en fixtures.

## Pendiente de resolver

- Un procedimiento reproducible, autorizado y mantenible para entregar contexto
  de sesión legítimo sin copiar credenciales manualmente.
- Confirmar si las tres credenciales observadas son suficientes y estables; un
  contexto suministrado puede seguir recibiendo HTTP 403.
- Confirmar los contratos internos de `images` y `promotions` antes de mapearlos.
- Confirmar la relación entre la sesión, la tienda, el código postal y los precios.
- Descubrir y validar por separado capacidades de búsqueda y catálogo, sin
  inferir endpoints a partir de nombres o de terceros.

## Condiciones para pasar a ACTIVE

1. Existencia de un flujo oficial o autorizado y reproducible para obtener y
   renovar el contexto requerido, sin eludir AWS WAF.
2. Selección de tienda/mercado confirmada y trazable para evitar mezclar precios.
3. Tests live repetibles en CI o en un entorno operativo autorizado, activados de
   forma explícita y con secretos gestionados fuera del repositorio.
4. Estabilidad observada del endpoint, manejo acordado de expiración/403 y
   monitorización de cambios de contrato.
5. Confirmación de las capacidades adicionales antes de declararlas disponibles.
