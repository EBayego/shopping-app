# Actualización programada de catálogo y precios

## Scheduler elegido

La automatización usa un workflow efímero de GitHub Actions
(`.github/workflows/ingestion-scheduler.yml`) cada 30 minutos, en los minutos 7
y 37 de cada hora. Cada invocación
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
| `price_refresh_interval_minutes`      |            60 | Cadencia de `PRICE_REFRESH`                    |
| `catalog_sync_interval_minutes`       |          1440 | Cadencia de `CATALOG_SYNC`                     |
| `refresh_request_max_attempts`        |             3 | Máximo de intentos por solicitud               |
| `refresh_request_retry_delay_minutes` |            15 | Espera entre intentos                          |
| `max_jobs_per_tick`                   |            50 | Límite de trabajos por invocación              |
| `running_timeout_minutes`             |           120 | Lease de recuperación de workers interrumpidos |

`CATALOG_SYNC` debe conservar una frecuencia menor que `PRICE_REFRESH`; la base
de datos valida esa relación. Para cambiar la política:

```sql
update public.ingestion_runtime_config
set price_refresh_interval_minutes = 30,
    catalog_sync_interval_minutes = 1440,
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

Mercadona y Alcampo disponen de estrategia de catálogo. DIA descubre productos
mediante búsquedas concretas y Eroski solo refresca productos previamente
conocidos; no se anuncian como catálogos completos hasta que exista una
estrategia de discovery confirmada para esos proveedores.

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
solicitud, así que un fallo de Eroski no bloquea DIA.

Cada pipeline persiste su run en `provider_sync_runs`, actualiza
`provider_health` y emite logs JSON. La cola conserva `PENDING`, `RUNNING`,
`SUCCEEDED` y `FAILED`, número de intentos, error saneado y worker. El workflow
conserva los logs estructurados de scheduler, retries y pipelines.
