# Actualización programada de catálogo y precios

## Scheduler elegido

La automatización usa un workflow efímero de GitHub Actions
(`.github/workflows/ingestion-scheduler.yml`) una vez al día a las 03:17 UTC
(05:17 en Madrid en verano, 04:17 en invierno). Cada invocación
ejecuta `pnpm ingest:scheduler`, pide a Supabase que encole únicamente los
trabajos vencidos y drena la cola hasta el límite configurado. No existe un
servidor o worker residente.

GitHub Actions solo aporta el pulso. Supabase es la fuente de verdad para la
cadencia, el estado, los reintentos y la exclusión mutua. Esto reutiliza la CLI,
los pipelines, `refresh_requests`, `provider_sync_runs` y `provider_health` ya
existentes, y permite ejecutar exactamente el mismo tick en local.

## Configuración

La única fila de `ingestion_runtime_config` centraliza la política:

| Campo                                 | Valor inicial | Uso                                            |
| ------------------------------------- | ------------: | ---------------------------------------------- |
| `price_refresh_interval_minutes`      |          4320 | Cadencia de `PRICE_REFRESH` (72 horas)         |
| `catalog_sync_interval_minutes`       |          4320 | Cadencia de `CATALOG_SYNC` (72 horas)          |
| `refresh_request_max_attempts`        |             3 | Máximo de intentos por solicitud               |
| `refresh_request_retry_delay_minutes` |            15 | Espera entre intentos                          |
| `max_jobs_per_tick`                   |            50 | Límite de trabajos por invocación              |
| `running_timeout_minutes`             |           120 | Lease de recuperación de workers interrumpidos |

`CATALOG_SYNC` debe conservar una frecuencia menor o igual que `PRICE_REFRESH`; la base
de datos valida esa relación. Para cambiar la política:

```sql
update public.ingestion_runtime_config
set price_refresh_interval_minutes = 4320,
    catalog_sync_interval_minutes = 4320,
    refresh_request_max_attempts = 3
where singleton;
```

`provider_job_schedules` contiene los scopes `provider + tipo + código postal`.
El dispatcher descubre scopes a partir de listas de compra y mercados conocidos.
También se pueden crear explícitamente, por ejemplo:

```sql
insert into public.provider_job_schedules (
  retailer_id, request_type, postal_code
)
select id, 'PRICE_REFRESH', '50009'
from public.retailers
where code = 'DIA'
on conflict (retailer_id, request_type, postal_code) do nothing;
```

En cada tick, los refreshes de precio seleccionan productos de listas activas,
ofertas stale/very-stale y productos indicados en solicitudes manuales usando
la política de frescura existente. Un catálogo completo solo se descarga cuando
vence su cadencia de catálogo; no se descarga en cada tick.

El pulso diario atiende solicitudes manuales y reintentos en el siguiente tick,
aunque su delay configurado sea de 15 minutos. No se garantiza ejecución exacta
a las 72 horas: un retraso o fallo de GitHub Actions desplaza el siguiente tick.
Los precios pueden tener tres días de antigüedad; se conserva la política real
de frescura y sus avisos. No se modifica `observed_at` para aparentar frescura.

## Retención y liberación de espacio

`dispatch_due_provider_jobs()` ejecuta automáticamente
`private.cleanup_ingestion_history()` antes de encolar trabajos, incluso si
no hay ingestas vencidas. No requiere habilitar `pg_cron`.

- `price_history`: conserva 90 días desde `created_at`.
- `provider_sync_runs`: elimina ejecuciones terminadas hace más de 30 días.
- `refresh_requests`: elimina solicitudes `SUCCEEDED`/`FAILED` terminadas
  hace más de 30 días; conserva `PENDING` y `RUNNING`.
- `admin_audit_log`: conserva 90 días.

Cada tick elimina hasta 5.000 filas por tabla, con locks que omiten filas en uso.
La retención requiere ticks exitosos y no es un límite absoluto en MB: un volumen
mayor que la limpieza diaria puede dejar un backlog. Los productos nuevos,
mercados y datos de usuario también pueden aumentar el tamaño. No se eliminan
catálogo actual, clasificaciones manuales, usuarios, grupos ni listas.

La migración `20261003090000_ingestion_cadence_and_retention.sql` configura la
cadencia y permite precios y catálogo con el mismo intervalo. Deja los schedules
habilitados vencidos para que el primer tick los atienda. Aplícala con
`pnpm exec supabase db push --linked` antes de activar el workflow modificado;
también puede ejecutarse su contenido completo en el SQL Editor si no dispones
de una conexión CLI. No crea otra automatización de limpieza.

`TRUNCATE` ya devuelve el espacio ocupado por las tablas vaciadas; no necesita
`VACUUM`. Después de `DELETE`, autovacuum permite reutilizar espacio. Si deseas
ejecutar un vacuum manual, selecciona **una sola sentencia** y ejecútala sola:

```sql
vacuum (analyze) public.price_history;
```

Ejecuta las demás tablas por separado, sin `BEGIN`/`COMMIT` ni otras sentencias
en la misma petición: PostgreSQL prohíbe `VACUUM` dentro de una transacción.
`VACUUM FULL` solo se justifica tras medir bloat, durante mantenimiento y con
espacio temporal disponible; bloquea la tabla. No se ejecuta desde la función.

Si anteriormente se habilitó otro job de `pg_cron`, su histórico
`cron.job_run_details` necesita retención independiente. Esta solución no
crea registros en esa tabla.

## Entornos

Actualmente hay un único proyecto Supabase remoto. El workflow ejecuta un solo
tick contra ese proyecto usando estos Repository Secrets:

- `SUPABASE_URL`: URL del proyecto Supabase remoto.
- `SUPABASE_SECRET_KEY`: secret key server-side del mismo proyecto.

Development continúa usando Supabase local y una ejecución manual. Las builds
móviles que apunten al mismo proyecto remoto comparten su catálogo y sus
precios; no necesitan un scheduler independiente.

Los workflows programados usan la rama por defecto del repositorio, actualmente
`develop`. Cuando exista un segundo proyecto Supabase para producción, se deben
separar sus credenciales y su ciclo de despliegue antes de añadir un segundo
tick. No definas la secret key como variable `EXPO_PUBLIC_*`.

## Bootstrap de retailers y catálogo

Los registros operativos de DIA, Mercadona, Alcampo y Eroski se crean mediante
migraciones, por lo que existen después de `supabase db push` sin ejecutar el
seed. `seed.sql` solo contiene mercados, productos, matches, precios y ofertas
demo para desarrollo local.

El primer tick descubre los códigos postales presentes en `shopping_lists` y
`retailer_market_postal_codes`, crea los correspondientes
`provider_job_schedules`, encola los trabajos vencidos y los procesa. Para
comprobar el bootstrap de un entorno:

```sql
select code, operational_status, capabilities
from public.retailers
order by code;

select retailer_id, request_type, postal_code, enabled, next_run_at
from public.provider_job_schedules
order by postal_code, request_type, retailer_id;

select status, request_type, postal_code, count(*)
from public.refresh_requests
group by status, request_type, postal_code
order by postal_code, request_type, status;
```

Mercadona, Alcampo, DIA y Eroski disponen de estrategia de catálogo. DIA obtiene el
árbol desde `menu-data` y recorre las páginas PLP de cada subcategoría, además
de conservar su búsqueda bajo demanda. Eroski inicia una sesión anónima limpia,
usa la tienda pública de alimentación `157` y recorre el HTML y la paginación
Tapestry de las categorías. También ofrece búsqueda y refresh directo mediante
`/productdetail/{id}-x/`. Como esa tienda no se resuelve desde el código postal,
sus precios son orientativos y el retailer permanece `DEGRADED`.

## Variables y secretos

La CLI necesita:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (`sb_secret_...`)
- `REFRESH_WORKER_ID` (opcional)

Configura las dos primeras como Repository Secrets con esos nombres. Para local
usa un `.env` no versionado o variables de sesión; el repositorio solo incluye
`tooling/ingest/.env.example` con valores ficticios.

`SUPABASE_SECRET_KEY` es exclusivamente server-side: nunca debe aparecer en
`apps/mobile`, código enviado al navegador, variables `EXPO_PUBLIC_*`, URLs ni
logs. El runtime REST la envía únicamente en el header `apikey`; no la duplica
como `Authorization: Bearer`, porque las nuevas secret keys son opacas y no son
JWT. Consulta la [guía oficial de API keys de Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

## Ejecución manual

Con las variables cargadas, el mismo tick usado por GitHub Actions se ejecuta
con:

```bash
pnpm ingest:scheduler
```

Para consumir exactamente una solicitud ya encolada:

```bash
pnpm ingest:worker
```

La CLI de diagnóstico sigue disponible para un refresh dirigido:

```bash
pnpm ingest refresh --provider dia --postal-code 50009 --product-id 261354
```

## Pausas y estados

Marcar un provider como `DISABLED` desde el admin impide nuevas solicitudes y
el claim de solicitudes pendientes. No elimina configuración ni historial. Al
reactivarlo, los schedules vencidos se atienden en el siguiente tick.

`DEGRADED` sí se ejecuta: conserva la política existente de concurrencia por
provider, retries con backoff y circuit breaker. Para pausar solo un scope sin
deshabilitar todo el provider:

```sql
update public.provider_job_schedules
set enabled = false
where id = '<schedule-id>';
```

## Fallos, locking y observabilidad

El claim usa `FOR UPDATE SKIP LOCKED`, por lo que varios ticks pueden consumir
solicitudes distintas. Un índice único parcial en `provider_sync_runs` impide
dos ejecuciones `running` del mismo `provider + market + strategy`. Los leases
vencidos se cierran como fallidos y las solicitudes huérfanas se recuperan.

Un fallo de provider se completa y se reprograma con delay hasta alcanzar el
límite de intentos. Después queda `FAILED`; los éxitos quedan `SUCCEEDED`
(equivalente operativo a `SUCCESS`). El runner continúa con la siguiente
solicitud, así que el fallo de un provider no bloquea los demás.

Cada pipeline persiste su run en `provider_sync_runs`, actualiza
`provider_health` y emite logs JSON. La cola conserva `PENDING`, `RUNNING`,
`SUCCEEDED` y `FAILED`, número de intentos, error saneado y worker. El workflow
conserva los logs estructurados de scheduler, retries y pipelines.
