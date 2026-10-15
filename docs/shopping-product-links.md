# Artículos libres y enlaces a productos

La entrada por texto añade el nombre escrito y una ilustración local. Conserva el
parser existente para cantidades y envases y funciona con SQLite/outbox sin
consultar el catálogo. La entrada por voz mantiene su flujo anterior.

Cada tarjeta permite marcar, cambiar cantidad, editar, borrar y abrir el selector
de enlace. El selector utiliza el catálogo existente filtrado por supermercados
de la lista y el código postal. Se elige un producto y mercado concretos. También
se puede quitar el enlace. El nombre y la cantidad del artículo se conservan.

## Persistencia y sincronización

`shopping_intents.linked_offer_id` referencia una oferta real. `product_link` es
un snapshot de presentación validado y construido en el servidor, con producto,
supermercado, formato, precio observado, fecha y origen manual/automático. No es
una cotización en tiempo real. Los clientes no tienen permisos para escribir esas
columnas directamente.

Los enlaces manuales y su eliminación usan operaciones idempotentes y la outbox
existente. Los IDs locales se remapean tras sincronizar el alta. La RPC comprueba
que los datos del artículo siguen siendo los mismos y vuelve a validar mercado,
disponibilidad y supermercados habilitados. Una selección obsoleta pasa a conflicto
siguiendo el comportamiento del resto de operaciones.

Cambiar nombre normalizado, variante, marca, cantidad o envase invalida el enlace;
cambiar el código postal invalida los enlaces de la lista. Marcar como comprado
conserva el enlace. Las actualizaciones se propagan por el canal privado del grupo,
incluidos los cambios de supermercados. Las cachés antiguas sin campos de enlace
siguen siendo legibles.

## Enlace automático

Requiere conexión y no tener cambios pendientes o conflictos. Una sola consulta
recupera todos los candidatos de las intenciones abiertas; no reutiliza el límite
de 20 resultados de la búsqueda visual. Admite hasta 500 elecciones por lote.

El motor de dominio reutiliza el comparador para calcular el coste de los envases
necesarios para cubrir la cantidad. Este modo utiliza `CHEAPEST_COVERING`, conserva
las marcas/variantes solicitadas y exige clasificación aceptada con confianza alta.
Excluye productos no disponibles, precios de más de 24 horas y mercados cuyo
precio sea orientativo por ubicación. No aplica descuentos de membresía ni supone
que una promoción de varias unidades o cupón se aplica a cada unidad.

Para productos genéricos usa la cantidad de referencia del concepto y la muestra
en la tarjeta enlazada. Si faltan datos de cantidad, clasificación o equivalencia,
el artículo queda para revisión. El concepto amplio de carne requiere una especie
explícita. Las migraciones amplían los cinco conceptos originales con doce
conceptos habituales y clasifican productos que todavía no tenían clasificación,
conservando las decisiones previas.

El resultado puede repartir la compra entre varios supermercados. Los enlaces
manuales se conservan; los automáticos se pueden recalcular. La aplicación de un
lote revalida el artículo, la oferta observada, la selección y la ubicación, y omite
elecciones que hayan cambiado durante la búsqueda. Deshacer restaura solo los
artículos que siguen exactamente como los dejó ese lote.

La comparación de cesta respeta el producto enlazado en su supermercado. Una
elección manual puede usarse sin clasificación global; en solicitudes genéricas
su formato sirve como referencia para comparar con otros supermercados.

No se añaden servicios de IA ni llamadas directas a supermercados desde el móvil.

## Despliegue y comprobaciones

Aplicar las tres migraciones `20261015100000`, `20261015110000` y `20261015120000`
antes de distribuir la nueva build móvil. Las migraciones son aditivas respecto a
las listas existentes y no requieren ejecutar el seed.

Comandos de verificación:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm supabase:test
pnpm mobile:bundle-check
```

Las pruebas SQL comprueban aislamiento, permisos de escritura, mercado y selección,
idempotencia, clasificación, comparación, invalidación de enlaces, aplicación de
lotes y deshacer frente a ediciones posteriores.
