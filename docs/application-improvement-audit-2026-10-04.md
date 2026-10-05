# Auditoría de la aplicación y propuestas de mejora

Fecha: 4 de octubre de 2026.

La aplicación tiene una arquitectura adecuada para su beta y una suite automatizada amplia. Las mejoras con mayor retorno son aumentar la fiabilidad de la comparación y la cobertura de productos, aislar correctamente los datos offline por identidad y reducir el trabajo repetido de las ingestas. Las funcionalidades nuevas deben apoyarse en esos tres puntos.

## Alcance y evidencia

Se revisaron el monorepo, las pantallas y repositorios móviles, la sincronización SQLite, el dominio de comparación, las migraciones SQL, el admin, los pipelines y workflows de ingesta y las auditorías existentes. Se ejecutaron lint, typecheck, tests y una auditoría de dependencias. También se ejecutó una comprobación local del comparador con datos ficticios.

Los hallazgos distinguen comportamiento confirmado por código, reproducciones locales y optimizaciones que requieren medición. No se consultó la base de datos remota ni se ejecutaron ingestas, llamadas de IA, pruebas live de supermercados o workflows remotos. Los resultados operativos de GitHub citados proceden de la auditoría existente; no constituyen una comprobación nueva del servicio desplegado.

Antes de esta revisión ya había una modificación en `apps/mobile/app.json`. Se ha conservado. Esta auditoría añade únicamente este documento; el script temporal de comprobación se eliminó tras ejecutarlo.

## Estado actual

| Componente       | Implementación observada                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicación móvil | Expo Router, React Native, TanStack Query y Zustand; grupos, invitaciones, productos editables, búsqueda, voz, ajustes y comparación.                                 |
| Identidad        | Sesión anónima persistida en SecureStore y vinculación/inicio de sesión con Google y Apple por PKCE. Su habilitación remota depende de la configuración del proyecto. |
| Colaboración     | RPCs atómicas e idempotentes, broadcasts privados por grupo y reconciliación con PostgreSQL.                                                                          |
| Offline          | Caché SQLite, proyección local y outbox ordenado; replay al recuperar conectividad o volver a foreground.                                                             |
| Catálogo         | Productos y ofertas por mercado, normalización de formatos, conceptos y clasificaciones revisables. La búsqueda móvil consulta Supabase.                              |
| Comparación      | Cobertura, cantidades/envases, unidades, peso variable, promociones, antigüedad y productos no encontrados.                                                           |
| Ingestión        | Adaptadores DIA, Mercadona, Alcampo y Eroski; lotes, deduplicación, reintentos, cortacircuitos, persistencia parcial y cola con leases.                               |
| Operación        | Admin SSR con Basic Auth y auditoría; scheduler GitHub Actions; tests unitarios/integración y pgTAP en CI.                                                            |

TypeScript mantiene `strict`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. El repositorio fija `pnpm@11.20.0`. No hay motivo demostrado para sustituir el framework, el package manager o Supabase.

Hay mejoras recientes que deben reutilizarse: catálogo incremental, paginación de candidatos mediante `limit/offset` con detección de duplicados, refresh grande de Mercadona por catálogo, distinción de bloqueos `403`/WAF y retención del histórico de ingestas. La voz ya conserva el texto ante fallos y ofrece un parser local; la recuperación de identidad mediante vinculación social ya tiene implementación.

## Prioridades

El esfuerzo es relativo: pequeño afecta a un flujo limitado; medio cruza varias capas; grande requiere diseño, migraciones y validación operativa. No son estimaciones de plazo.

| ID  | Prioridad  | Mejora                                                                 | Impacto                                              | Esfuerzo           | Evidencia                            |
| --- | ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------------ | ------------------------------------ |
| A1  | Alta       | Separar caché y outbox por usuario y gestionar cambios de identidad    | Privacidad local y conservación de cambios           | Medio              | Código                               |
| A2  | Alta       | Invalidar comparación/búsqueda tras mutaciones, sync y Realtime        | Totales y mercados coherentes con la lista           | Pequeño/medio      | Código                               |
| A3  | Alta       | Conservar decisiones humanas de clasificación                          | Evitar equivalencias rechazadas que reaparecen       | Medio              | Código SQL; falta reproducción pgTAP |
| A4  | Alta       | Ampliar conceptos y conservar la selección de productos concretos      | Más productos realmente comparables                  | Grande, por etapas | Código y migraciones                 |
| A5  | Alta       | Propagar la fiabilidad geográfica del precio                           | Evitar presentar Eroski como precio local confirmado | Medio              | Código                               |
| A6  | Alta       | Revisar dependencias con avisos altos                                  | Reducir deuda de seguridad y mantenimiento           | Medio              | `pnpm audit`                         |
| A7  | Media/alta | Alinear consumo de cola, frescura y cadencias                          | Menor espera y precios más útiles                    | Medio              | Código y configuración               |
| A8  | Media/alta | Persistir refresh por lotes y reintentar solo fallos                   | Menor pérdida/repetición ante interrupciones         | Medio/grande       | Código                               |
| A9  | Media      | Aclarar elección por frescura y cálculo de precio unitario promocional | Comparación consistente                              | Medio              | Reproducción local                   |
| A10 | Media      | Evitar barridos duplicados por job y por mercado                       | Menos llamadas y escrituras                          | Medio/grande       | Código; ahorro por medir             |
| A11 | Media      | Resolver conflictos offline y reintentar errores transitorios          | Recuperación visible y fiable                        | Medio              | Código                               |
| A12 | Media      | Virtualizar listas y reducir cálculos/payloads                         | Fluidez y consumo de memoria al crecer               | Medio              | Código; rendimiento por medir        |

### A1. Aislamiento offline por identidad

`SQLiteShoppingStore` usa un único `shopping-offline.db`. Las tablas de caché y `pending_operations` no tienen un propietario de sesión; `nextPending()` selecciona la primera operación global. `OfflineSyncProvider` comprueba que existe una sesión, pero el motor aplica la cola compartida con el cliente Supabase de la identidad vigente.

Además, `getOfflineGroupDetail()` devuelve la caché ante cualquier error remoto, incluidos errores de autorización. La limpieza de TanStack en `SessionProvider` solo se ejecuta cuando la sesión recibida es nula; un cambio directo de usuario no separa SQLite. Un usuario distinto puede ver datos locales anteriores y las operaciones del usuario anterior pueden intentarse bajo otra identidad. RLS sigue protegiendo el servidor, pero no resuelve el aislamiento local.

Propuesta: particionar caché, metadatos y outbox por `user.id`; parar el replay durante el cambio de sesión y reanudar únicamente su cola. Conservar la partición cuando se vincula una cuenta sin cambiar el UUID. No borrar operaciones pendientes indiscriminadamente. Diferenciar fallos de red de revocación de acceso y evitar que un `42501` exponga un snapshot antiguo. Validar también una operación en curso durante el cambio de cuenta.

Fuentes: `apps/mobile/offline/sqlite-shopping-store.ts:12,103,256`; `apps/mobile/offline/offline-shopping-repository.ts:22`; `apps/mobile/offline/offline-sync-provider.tsx:52`; `apps/mobile/features/auth/session-provider.tsx:75`.

### A2. Actualización de consultas derivadas

`completeLocalMutation()` actualiza el detalle del grupo y lanza sync. La finalización del sync y los broadcasts invalidan consultas de grupos; la comparación usa otra raíz, `basket-comparison`. La búsqueda usa `product-search`, cuya clave no incluye el código postal. Las preferencias de supermercados sí invalidan búsqueda y comparación, por lo que ya existe un patrón aprovechable.

Consecuencia: cantidades, productos marcados/eliminados o cambios de código postal pueden dejar un resultado anterior en caché. El `staleTime` por sí solo no programa una actualización; la consulta tampoco se refresca globalmente al recuperar foco. Las ediciones aún pendientes de subir no forman parte de la RPC de comparación.

Propuesta: centralizar invalidaciones por lista y ejecutarlas después de confirmar el replay en el servidor y al recibir cambios remotos relevantes. Marcar la comparación como pendiente cuando haya operaciones locales, o calcular explícitamente sobre una proyección local compatible. Reconciliar al volver a la pantalla. Invalidar búsqueda y supermercados al cambiar CP; separar también estas claves por identidad. La invalidación explícita de consultas relacionadas es el mecanismo documentado por [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations).

Fuentes: `apps/mobile/features/groups/queries.ts:209`; `apps/mobile/features/groups/realtime.ts:17`; `apps/mobile/offline/offline-sync-provider.tsx:66`; `apps/mobile/features/comparison/queries.ts:5`; `apps/mobile/features/search/queries.ts:5`; `apps/mobile/features/supermarkets/queries.ts:48`.

### A3. Revisiones de clasificación que sobreviven a una ingesta

Aceptar o rechazar una clasificación cambia su estado y campos de revisión, pero mantiene su método. El clasificador protege únicamente clasificaciones `ACCEPTED` con método `MANUAL`; después elimina todas las clasificaciones no manuales y vuelve a generarlas. El trigger se ejecuta cuando una ingesta actualiza los campos indicados, aunque sus valores sean iguales.

Por ello, una clasificación automática rechazada por una persona puede volver a aceptarse en la siguiente importación. También puede perderse una aceptación humana de una propuesta automática. Esto afecta directamente a la confianza del comparador.

Propuesta: registrar la decisión humana separadamente de la propuesta automática y respetarla durante reclasificaciones. Distinguir autorrevisión de revisión humana: el booleano `reviewed` actual también se utiliza para autoaceptaciones. Reclasificar solo cuando cambien los atributos relevantes o la versión de reglas. Añadir casos pgTAP de rechazo/aceptación seguido de reingesta y comprobar que se conserva la decisión.

Fuentes: `supabase/migrations/20260814120000_product_concepts.sql:223,281,330`; `supabase/migrations/20260814121000_product_concept_runtime.sql:12,43`; `supabase/migrations/20260809140000_ingestion_pipeline.sql:74`.

### A4. Cobertura útil y selección concreta

Las migraciones incorporan cinco conceptos: leche, huevos, patatas, tomate triturado y carne fresca. La búsqueda admite productos sin clasificar, pero la comparación solo obtiene candidatos vinculados a un concepto aceptado/revisado. Añadir un resultado sin concepto guarda su nombre y un concepto nulo; no conserva el ID del producto seleccionado. Si la resolución posterior no encuentra concepto, ese producto no obtiene candidatos comparables.

El concepto «carne fresca» agrupa pollo, pavo, cerdo y vacuno. Una petición específica necesita una variante u otro atributo que impida sustituir una especie por otra. El tipo de envase ya se guarda en la intención, pero no forma parte de `BasketIntent` ni de la selección de candidatos.

Propuesta por etapas: medir qué búsquedas/pedidos reales quedan sin concepto; ampliar categorías frecuentes mediante migraciones y reglas con ejemplos positivos/negativos; separar atributos de especie, variedad y formato; conservar una selección concreta cuando el usuario la haga. La comparación debe indicar si propone una equivalencia, un sustituto o el SKU solicitado. Reutilizar GTIN y la revisión manual existentes cuando haya datos confirmados.

No se ha contado el catálogo ni los conceptos del proyecto remoto: puede contener clasificaciones o conceptos añadidos desde el admin. La limitación de cinco describe lo que proporciona el repositorio al desplegar sus migraciones.

Fuentes: `supabase/migrations/20260814120000_product_concepts.sql:135`; `supabase/migrations/20260814121000_product_concept_runtime.sql:356,419`; `apps/mobile/app/groups/[groupId].tsx:169`; `packages/domain/src/basket-comparison.ts:11`.

### A5. Fiabilidad y procedencia geográfica

Eroski resuelve una tienda pública, marca `marketResolution=public-default` y `pricesMayVaryByLocation=true`, y conserva el CP solicitado como etiqueta. La búsqueda devuelve identificadores/nombre del mercado, pero no esa metadata. La RPC de comparación pierde también la procedencia del mercado y solo comunica la frescura temporal.

Propuesta: conservar en búsqueda y comparación si el precio corresponde al CP, a una tienda pública orientativa o a un mercado sin confirmar. Mostrar la tienda de origen y la fecha real. Evitar destacar un ganador local sin informar de esa limitación. Resolver Eroski por ubicación solo cuando exista un flujo confirmado; el estado `DEGRADED` por sí solo no explica el motivo a quien compara una cesta.

Fuentes: `providers/eroski/src/eroski-provider.ts:85`; `supabase/migrations/20260814121000_product_concept_runtime.sql:393,551`; `apps/mobile/app/comparison/[listId].tsx:52`; `docs/ingestion-provider-audit.md:244`.

### A6. Dependencias

La ejecución actual de `pnpm audit --audit-level high` termina con código 1 y comunica 48 avisos: 30 altos, 15 moderados y 3 bajos. Entre las rutas mostradas hay dependencias transitivas de Expo/CLI, XML, patrones de ficheros y certificados, como `@xmldom/xmldom`, `braces` y `node-forge`.

Propuesta: clasificar cada aviso según su uso en desarrollo, build, servidor o bundle; actualizar dentro de versiones compatibles con el stack existente; aplicar overrides solo después de verificar compatibilidad. Incorporar una revisión periódica y un gate con excepciones justificadas. Los avisos no demuestran por sí mismos explotación en el móvil. La auditoría antigua que enumera tres avisos ya no refleja este resultado.

Validar cambios de dependencias con lint, typecheck, tests, exportación de bundle y builds/dispositivos cuando afecten módulos nativos. Esta revisión no ha actualizado paquetes ni el lockfile.

### A7. Cadencias, frescura y espera de la cola

El workflow aporta un pulso diario a las 03:17 UTC; precios y catálogo vencen cada 4.320 minutos (72 horas). Los reintentos de cola esperan 15 minutos en SQL, pero un runner efímero que termina al quedarse sin trabajos no vuelve por sí mismo a los 15 minutos. Solicitudes manuales y reintentos pueden esperar al siguiente pulso.

La política inicial de frescura considera un precio `STALE` a las 6 horas y `VERY_STALE` a las 24. Con un intervalo regular de 72 horas y sin refresh adicional, una oferta pasa unas 48 horas de cada ciclo como muy antigua. Es una consecuencia de la política actual, no un motivo para alterar artificialmente `observed_at` ni ampliar umbrales para ocultarla.

Propuesta: acordar una antigüedad objetivo y un presupuesto de llamadas. Mantener el barrido de catálogo espaciado y diferenciar refresh de productos activos, solicitudes manuales y recuperación de fallos. Un pulso más frecuente puede consumir solo lo pendiente sin descargar catálogo cada vez. Cambiarlo exige revisar coste y acceso real desde GitHub; la reducción a 72 horas puede ser intencional.

La auditoría anterior documenta bloqueos distintos entre equipo local y runners hospedados. El workflow de comparación Ubuntu/Windows/macOS ya existe: utilizar sus resultados antes de cambiar el runner. Aumentar concurrencia o reintentos no corrige un acceso denegado. No se ha comprobado nuevamente ese acceso en esta revisión.

Fuentes: `.github/workflows/ingestion-scheduler.yml:6`; `tooling/ingest/src/scheduled-ingestion.ts:36`; `supabase/migrations/20260809230000_scheduled_ingestion.sql:190`; `supabase/migrations/20261003090000_ingestion_cadence_and_retention.sql:17`; `supabase/migrations/20260809170000_product_search.sql:8`; `docs/ingestion-provider-audit.md:17`.

### A8. Refresh incremental y reanudación

El catálogo ya persiste progresivamente. El refresh de precios, en cambio, materializa todos los candidatos, crea una promesa por seleccionado, reúne los resultados y guarda las ofertas al final. La concurrencia HTTP está limitada, pero no la cantidad de objetos/promesas en memoria. Una interrupción antes de persistir pierde el trabajo obtenido en ese refresh.

Una ejecución parcial se reprograma con la misma solicitud. Para productos de listas activas, la selección vuelve a incluirlos aunque se hayan refrescado con éxito. Para un catálogo parcial tampoco se conserva un checkpoint persistente de categorías completadas.

Propuesta: procesar candidatos en ventanas, guardar ofertas y progreso por lote, y reencolar únicamente IDs/categorías fallidos. Usar paginación estable o un snapshot de selección y un presupuesto de duración por tick. Mantener la protección de no retirar productos por un listado parcial: un barrido reanudado solo puede registrar ausencias cuando esté completo. Renovar leases en trabajos largos y exigir identidad/token de claim al completar para evitar que un worker antiguo cierre el trabajo de otro.

Fuentes: `packages/ingestion/src/price-refresh-pipeline.ts:106,113,185`; `packages/ingestion/src/supabase-store.ts:95`; `tooling/ingest/src/refresh-request-worker.ts:124`; `supabase/migrations/20260809230000_scheduled_ingestion.sql:86,149`.

### A9. Frescura del candidato y promociones por unidad

Se ejecutó el comparador con datos ficticios válidos para observar dos comportamientos:

| Caso                                                                                         | Resultado actual                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Dos productos equivalentes del mismo retailer: uno `VERY_STALE` a 1 €, otro `FRESH` a 1,10 € | Se elige el antiguo.                             |
| Envase de 1 L: normal 2 €, promo 1 €, `pricePerUnit=2 €/L`                                   | Total 1 €, precio mostrado por litro 2 €.        |
| Mismo esquema para un producto de peso variable de 1 kg                                      | `effectiveUnitPrice=1`, pero total estimado 2 €. |

La frescura domina el ranking entre cestas, mientras que dentro de una cesta el precio domina la elección del candidato. Conviene explicitar y probar esa decisión: priorizar ofertas recientes, excluir las muy antiguas cuando haya alternativa o permitir al usuario una política visible.

`normalizedPrice()` utiliza el dato unitario recibido sin relacionarlo con la promoción o la membresía aplicada. La reproducción demuestra la inconsistencia con un precio unitario del importe normal; no confirma qué semántica aporta cada endpoint externo. Para envases con cantidad conocida puede derivarse el precio unitario del importe efectivo. Para peso variable debe verificarse el contrato del provider y conservar explícitamente las bases necesarias. Añadir casos con y sin membresía y promociones en peso variable.

Fuentes: `packages/domain/src/basket-comparison.ts:173,247,368,393`; `packages/domain/src/basket-comparison.test.ts:93,127,146`.

### A10. Trabajo duplicado y salud operativa

Catálogo y refresh vencen a la vez, pero son solicitudes distintas sin dependencia entre ellas. El catálogo ya contiene ofertas. Un refresh grande de Mercadona puede descargar otro catálogo; las listas activas vuelven a seleccionarse incluso después de un catálogo reciente. El orden actual por fecha/UUID no garantiza reutilización de esas observaciones.

Además, el dispatcher cruza todos los retailers con todos los CP conocidos. Varios CP pueden resolver al mismo almacén/tienda, especialmente la tienda pública de Eroski. La exclusión de runs por mercado/tipo impide simultaneidad de ese tipo, pero no evita barridos duplicados consecutivos.

Propuesta: coordinar catálogo y refresh por mercado resuelto, registrar qué productos y fechas cubrió cada barrido y ejecutar refresh dirigido solo para lo pendiente. Mantener los mappings de CP y distinguir stock/precios si el retailer realmente los diferencia. Medir peticiones por producto útil y duplicados por mercado antes de cambiar la planificación.

El breaker actual pertenece al executor creado por trabajo y se reinicia en el siguiente. Un cooldown persistido por provider/mercado ayudaría a espaciar denegaciones repetidas entre jobs/ticks. Los clientes REST de ingesta, cola y dispatcher tampoco fijan un timeout explícito propio: añadir cancelación y reintentos acotados para errores de transporte, considerando idempotencia y reconciliación de claims ambiguos.

Fuentes: `supabase/migrations/20261003090000_ingestion_cadence_and_retention.sql:121`; `packages/ingestion/src/catalog-price-refresh-strategy.ts:25`; `packages/ingestion/src/price-refresh-policy.ts:69`; `packages/ingestion/src/resilience.ts:57`; `packages/ingestion/src/supabase-store.ts:323`; `tooling/ingest/src/refresh-request-worker.ts:223`.

### A11. Recuperación de conflictos offline

El motor marca conflictos permanentes y continúa. La UI muestra el contador, pero el store no ofrece listar, resolver, descartar o reaplicar operaciones en conflicto. Para errores transitorios, el motor se detiene y espera una señal de conectividad/foreground, una nueva mutación o un reintento manual; no programa backoff propio mientras la red continúa disponible.

Propuesta: pantalla de cambios pendientes con causa comprensible y resolución explícita, reintentos transitorios acotados en foreground y estado por grupo/lista. No fusionar incrementos ni descartar operaciones si eso rompe su orden o identidad idempotente. Validar revocación de acceso, intent eliminado y dependencias entre un alta local y ediciones posteriores.

Fuentes: `apps/mobile/offline/sync-engine.ts:30`; `apps/mobile/offline/sqlite-shopping-store.ts:163`; `apps/mobile/offline/offline-sync-provider.tsx:59`; `apps/mobile/app/groups/[groupId].tsx:288`.

### A12. Rendimiento móvil y consultas

Las listas y la comparación renderizan sus filas con `.map()` dentro de `Screen`, que utiliza `ScrollView`. Para listas grandes, `FlatList`/`SectionList` permiten mantener una ventana de filas, mientras `ScrollView` crea todos sus hijos. Este comportamiento está documentado por [React Native](https://reactnative.dev/docs/scrollview).

Propuesta: virtualizar la lista de compra y las líneas de comparación; separar filas y formularios de edición; medir apertura, scroll y actualización de una fila en build release con 20/100/500 productos. El comparador filtra candidatos de nuevo por cada intención y retailer: indexarlos en un mapa evita esos recorridos repetidos sin cambiar el algoritmo comercial.

La búsqueda limita conceptos/resultados, pero agrega todos los productos y ofertas de cada concepto. El JSON de comparación también incluye todos los candidatos de conceptos aplicables. Ampliar la taxonomía puede aumentar esos payloads. Devolver resúmenes y detalles bajo demanda o paginar ofertas reduce transferencia; no cortar arbitrariamente candidatos que podrían ser los únicos que cumplen marca, variante o cantidad.

La búsqueda ya tiene debounce de 350 ms e índices trigram; conviene conservarlos. Su función de consulta no consume una señal de cancelación. Conectar la cancelación hasta la petición puede evitar trabajo de búsquedas abandonadas, según el contrato de [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation). Medir planes de SQL y tamaños reales antes de añadir índices o cambiar las RPCs. [PostgreSQL 17 explica el uso de EXPLAIN, ANALYZE y BUFFERS](https://www.postgresql.org/docs/17/using-explain.html).

Fuentes: `apps/mobile/components/screen.tsx:21`; `apps/mobile/app/groups/[groupId].tsx:394`; `apps/mobile/app/comparison/[listId].tsx:52`; `packages/domain/src/basket-comparison.ts:117`; `supabase/migrations/20260814121000_product_concept_runtime.sql:532`; `apps/mobile/features/search/queries.ts:13`.

## Procesos, métricas y mantenimiento

| Área                         | Mejora propuesta                                                                                                               | Motivo concreto                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin                        | Paginación y filtros de servidor; agregados operativos por retailer/mercado y ventana temporal                                 | Los listados se limitan a 200 filas y las anomalías cruzan muestras independientes de 1.000 productos, 2.000 ofertas y 4.000 precios; pueden quedar relaciones fuera de muestra. |
| Alertas de ingesta           | Edad de la oferta, espera de cola, último éxito por mercado, categorías completas y tasa de bloqueos                           | Un job exitoso o un health check declarativo no garantizan cobertura útil para todas las listas. Reutilizar logs JSON, runs y health existentes.                                 |
| Calidad de datos             | Medir cobertura de conceptos, rechazos revisados, búsquedas sin resultados y porcentaje de listas comparables                  | Permite ampliar catálogo donde aporta valor y detectar regresiones de clasificación.                                                                                             |
| Retención                    | Medir backlog de filas vencidas, tamaño y crecimiento; limpieza adicional acotada si se acumula                                | Ya se eliminan hasta 5.000 filas por tabla y tick. La retención existente no limita catálogo, `raw_data`, usuarios o datos idempotentes.                                         |
| Pruebas de extremo a extremo | Automatizar lista → comparación actualizada, cambio de identidad y replay offline; mantener pruebas reales en dos dispositivos | La suite actual usa mocks/fixtures y un checklist manual para micrófono, conectividad y colaboración.                                                                            |
| CI                           | Añadir bundle Android, DB lint y comprobación de deriva de tipos SQL; integrar revisión de dependencias                        | El CI actual ya ejecuta lint, TS, Vitest, Deno y pgTAP; esas comprobaciones adicionales no aparecen en el workflow.                                                              |
| Voz                          | Medir correcciones en el preview, éxito, latencia y uso de fallback con ejemplos consentidos/anonimizados                      | El corpus inicial no permite cuantificar todavía precisión real. Mantener confirmación, cuotas y límites existentes.                                                             |
| Admin expuesto               | Migrar a identidad individual y roles si necesita varios operadores; conservar audit log                                       | Basic Auth compartido limita atribución y gestión de acceso. Es deuda ya documentada.                                                                                            |
| Documentación                | Corregir README y marcar auditorías históricas con su fecha                                                                    | El README aún dice pulso cada 30 minutos y enumera retención como deuda, aunque el workflow es diario y la migración de retención existe.                                        |

Fuentes principales: `apps/admin/src/queries.ts:15,247`; `supabase/migrations/20261003090000_ingestion_cadence_and_retention.sql:37`; `.github/workflows/ci.yml`; `docs/beta-e2e-checklist.md`; `README.md:188,377`.

## Funcionalidades nuevas con mejor encaje

| Funcionalidad                                         | Beneficio                                            | Orden y dependencia                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crear, renombrar y archivar listas dentro de un grupo | Separar compra semanal, limpieza o eventos           | Primero. El esquema y la pantalla ya admiten varias listas, pero el flujo móvil no permite crearlas. Requiere operaciones autorizadas e idempotentes.   |
| Favoritos y repetir una lista/compra                  | Menos escritura en compras habituales                | Primero, tras A1. Reutilizar intenciones estructuradas; definir cómo copiar cantidades y restaurar productos marcados.                                  |
| Tarjetas Club/membresías por usuario                  | Comparar con descuentos que realmente puede utilizar | Primero, tras A9. El dominio acepta `memberships`, pero el repositorio móvil llama al comparador sin esa opción.                                        |
| Alternativas seleccionables y producto fijado         | Explicar faltas y respetar marca/formato preferidos  | Después de A3/A4. Conservar elección y calidad de equivalencia; no sustituir automáticamente una petición específica.                                   |
| Orden por secciones y modo de compra                  | Recorrido más cómodo en tienda; pendientes/comprados | Junto a A12. Usar una taxonomía de la app, sin inventar la disposición física de supermercados.                                                         |
| Presupuesto y ahorro entre cestas equivalentes        | Decisión de compra más clara                         | Después de A2/A4/A5/A9. Comparar cobertura equivalente y advertir subtotal, fechas y promociones condicionadas.                                         |
| Histórico de precios y alertas                        | Identificar cambios y oportunidades                  | Después de estabilizar ingesta. Ya existe `price_history`, pero guarda cambios y conserva 90 días; decidir si basta y cómo conservar agregados.         |
| Código de barras                                      | Añadir o fijar un producto rápidamente               | Posterior. Reutilizar GTIN existente y medir su cobertura antes de añadir una integración externa.                                                      |
| Repartir compra entre un máximo de tiendas            | Ahorro opcional con una política comprensible        | Posterior a cobertura/frescura. Definir máximo de tiendas, sobrecompra y costes aportados por el usuario; no hay fuentes confirmadas de trayecto/envío. |

## Secuencia recomendada y criterios de aceptación

1. **Corregir integridad y confianza:** A1, A2, A3 y A5, junto con la revisión A6. Aceptación: cambiar de cuenta no expone/reproduce datos anteriores; una edición confirmada actualiza la comparación; una clasificación rechazada sigue rechazada después de reingestar; la procedencia orientativa del precio es visible.
2. **Ampliar cobertura:** A4 y A9. Aceptación: corpus de compra representativo con resolución/equivalencias verificadas, selección concreta conservada y promociones coherentes por envase y por unidad.
3. **Reducir coste y espera:** A7, A8 y A10. Aceptación: interrupción/reanudación sin repetir éxitos innecesarios, peticiones por producto útil medidas y espera de cola/edad de precio dentro del objetivo acordado.
4. **Mejorar uso habitual:** A11/A12, varias listas, favoritos y membresías. Aceptación: conflictos resolubles y flujos de compra medidos en dispositivos reales.

Antes de estimar ahorro o capacidad, recoger una línea base por mercado: duración p50/p95, llamadas externas, productos/ofertas útiles, edad p95 de ofertas de listas activas, retraso de cola, tamaño JSON de búsqueda/comparación, cobertura de conceptos y tamaño de tablas. Esta revisión no inventa mejoras porcentuales sin esos datos.

## Validaciones realizadas

| Comando/comprobación                                                                                    | Resultado                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short` al inicio                                                                          | Modificación previa en `apps/mobile/app.json`.                                                                                                      |
| `rg --files` y búsquedas de código/migraciones/workflows                                                | Arquitectura y evidencias inspeccionadas.                                                                                                           |
| `pnpm lint`                                                                                             | Correcto, código 0.                                                                                                                                 |
| `pnpm typecheck`                                                                                        | Correcto, código 0.                                                                                                                                 |
| `pnpm test`                                                                                             | 69 archivos y 473 tests correctos. Los tests de componentes emiten avisos de deprecación de `react-test-renderer`.                                  |
| `pnpm exec tsx tooling/audit-comparison-check.mts`                                                      | Código 0. Reproducciones sintéticas A9; archivo temporal retirado.                                                                                  |
| `pnpm audit --audit-level high`                                                                         | Código 1: 48 avisos, 30 altos, 15 moderados y 3 bajos.                                                                                              |
| `pnpm audit --json`                                                                                     | Confirma el resumen; la salida extensa se truncó al intentar procesarla en la herramienta. No se guarda un inventario exhaustivo en este documento. |
| `pnpm supabase:test`                                                                                    | No pudo conectar con PostgreSQL local; pgTAP no llegó a ejecutarse.                                                                                 |
| `pnpm exec supabase db lint --local --level warning`                                                    | No pudo conectar con PostgreSQL local.                                                                                                              |
| `deno check --config supabase/functions/deno.json supabase/functions/extract-shopping-intents/index.ts` | Deno no está instalado en este host. CI sí contiene esta comprobación.                                                                              |

Algunos procesos locales requirieron reintento fuera del lanzador restringido por su error `apply deny-read ACLs`. No se han reseteado datos, actualizado dependencias ni realizado despliegues.

Quedan pendientes las comprobaciones SQL/Deno, la validación en dispositivos y los datos operativos del proyecto remoto. Las principales decisiones de producto son antigüedad objetivo/precio de las llamadas, equivalencias permitidas, alcance de membresías y cuánto catálogo debe cubrir la comparación.
