# shopping-app

Beta end-to-end de una lista de compra compartida: identidad anónima, grupos e
invitaciones, colaboración Realtime, escritura offline con outbox, catálogo y
ofertas, entrada por voz y comparación de cesta por retailer.

## Arquitectura y monorepo

```text
Expo mobile ── public anon key ──> Supabase Auth/Postgres/Realtime
     │                                  ▲
     └── SQLite cache + outbox           │ service-role (solo backend)
                                        │
providers -> ingestion/scheduler/worker ┘
                         │
                         └── admin SSR interno
```

- `apps/mobile`: Expo Router, React Native, TanStack Query, SecureStore y
  SQLite. PostgreSQL es la fuente de verdad; SQLite permite lectura optimista y
  replay idempotente.
- `apps/admin`: servidor SSR interno con Basic Auth; no entrega service-role al
  navegador.
- `packages/domain`: dominio y comparador determinista.
- `packages/database`: tipos generados desde PostgreSQL.
- `packages/ingestion`: persistencia, matching, retry/backoff, circuit breaker y
  refresh de precios.
- `packages/product-normalization`, `packages/retailer-contracts` y
  `packages/voice-parser`: normalización, contratos y parser de voz.
- `providers/*`: adaptadores aislados por retailer.
- `tooling/ingest`: CLI, scheduler y consumidor de refresh requests.
- `supabase`: configuración local, migraciones, seed demo y pgTAP.

Los cambios concurrentes de cantidad se aplican mediante RPCs atómicas. Cada
operación lleva un UUID idempotente; el outbox conserva orden, reintenta al
recuperar red y después reconcilia el snapshot. Los triggers emiten broadcasts
privados `group:<uuid>` autorizados por membresía.

## Requisitos

- Node.js 22.
- pnpm 11.20.0 mediante Corepack.
- Docker Desktop para Supabase local.
- Android Studio/JDK para builds Android locales; macOS/Xcode para iOS local.
- Una development build (Expo Go no incluye el módulo nativo de voz).
- Para builds cloud: cuenta Expo/EAS. Para staging/production: proyectos
  Supabase separados.

## Instalación y desarrollo local

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm supabase:reset
pnpm exec supabase status -o env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

Rellena `apps/mobile/.env` con URL y public anon/publishable key. En Android
Emulator usa normalmente `http://10.0.2.2:54321`; en un dispositivo, la IP LAN
del host. Conserva `APP_ENV=development`,
`EXPO_PUBLIC_APP_SCHEME=shopping-app-dev` y usa el código postal `50009` para el
catálogo demo.

```powershell
pnpm --filter @shopping-app/mobile android
pnpm --filter @shopping-app/mobile start
```

La primera orden compila/instala el development client; la segunda inicia Metro
para ejecuciones posteriores. El seed contiene fixtures realistas de “leche
semidesnatada” y cuatro ofertas sin llamadas externas.

## Entornos y variables

Hay ejemplos sin secretos en `.env.example`, `.env.development.example`,
`.env.staging.example` y `.env.production.example`. Cada entorno necesita su
propio Supabase y sus propias credenciales:

| Variable                           | Dónde            | Sensibilidad              |
| ---------------------------------- | ---------------- | ------------------------- |
| `APP_ENV`                          | build Expo       | pública                   |
| `EXPO_PUBLIC_APP_SCHEME`           | bundle móvil     | pública                   |
| `EXPO_PUBLIC_SUPABASE_URL`         | bundle móvil     | pública                   |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`    | bundle móvil     | pública, limitada por RLS |
| `SUPABASE_URL`                     | ingest/admin     | servidor                  |
| `SUPABASE_SECRET_KEY`              | ingest/scheduler | secreta                   |
| `SUPABASE_SERVICE_ROLE_KEY`        | admin            | secreta                   |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | admin            | secretas                  |
| `REFRESH_WORKER_ID`                | workers          | no secreta                |
| `RUN_LIVE_PROVIDER_TESTS`          | tests manuales   | no secreta                |

Nunca pongas secret/service-role bajo `EXPO_PUBLIC_*`. Los valores de staging y
production deben vivir en el gestor de secretos del host, GitHub Environments y
EAS Environment Variables, no en Git.

Las variantes móviles son independientes:

| Perfil      | Identifier iOS/Android           | Scheme                 | Distribución               |
| ----------- | -------------------------------- | ---------------------- | -------------------------- |
| development | `com.shoppingapp.mobile.dev`     | `shopping-app-dev`     | development client interno |
| staging     | `com.shoppingapp.mobile.staging` | `shopping-app-staging` | interna                    |
| production  | `com.shoppingapp.mobile`         | `shopping-app`         | stores                     |

## Supabase: local, staging y production

Local usa Docker, anonymous auth y Realtime definidos en
`supabase/config.toml`:

```powershell
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:test
pnpm supabase:types
pnpm supabase:stop
```

`supabase:reset` aplica en orden todos los archivos de `supabase/migrations` y
después `supabase/seed.sql`. El seed es solo local/demo: `db push` no lo aplica.
No ejecutes `seed.sql` en staging o production. Crea cambios de esquema como
nuevas migraciones; no edites una ya desplegada. Regenera y versiona
`packages/database/src/database.types.ts` tras cambiar el esquema.

Para cada backend remoto, crea un proyecto independiente, habilita Anonymous
Sign-Ins y verifica Realtime. Después:

```powershell
pnpm exec supabase login
pnpm exec supabase link --project-ref YOUR_PROJECT_REF
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

Ejecuta primero contra staging, valida el checklist y repite el link/push con el
project ref de production. Haz backup y revisa el plan SQL antes de production.
Las credenciales backend se configuran en el runtime del admin/worker; no son
Supabase Edge secrets porque estos procesos son Node externos.

## Providers e ingestión

Estado funcional de beta:

| Provider  | Estado              | Capacidades confirmadas                                             |
| --------- | ------------------- | ------------------------------------------------------------------- |
| DIA       | ACTIVE              | búsqueda, catálogo paginado y refresh por mercado                   |
| Mercadona | ACTIVE              | catálogo por categorías y refresh; sin búsqueda live confirmada     |
| Alcampo   | DEGRADED            | catálogo y refresh; WAF intermitente limita barridos completos      |
| Eroski    | DEGRADED            | catálogo, búsqueda y refresh con tienda pública; precio orientativo |
| DISABLED  | ninguno por defecto | se puede pausar desde admin                                         |

La app nunca consulta al retailer: busca en PostgreSQL. Ejemplos de ingesta:

```powershell
pnpm ingest --provider dia --postal-code 50009 --query "leche"
pnpm ingest refresh --provider dia --postal-code 50009
pnpm ingest:worker
pnpm ingest:scheduler
```

Usa `--dry-run` para inspección cuando la estrategia lo admita. La ingesta de
catálogo Mercadona se crea desde la planificación del scheduler, no desde un
flag de búsqueda manual. El scheduler de
`.github/workflows/ingestion-scheduler.yml` ejecuta cada 30 minutos un único job
contra el proyecto Supabase remoto configurado en los Repository Secrets
`SUPABASE_URL` y `SUPABASE_SECRET_KEY`. Evita runs concurrentes por scope, usa
leases/`SKIP LOCKED`, reintentos y conserva auditoría. Bootstrap, operación y
pausas: `docs/ingestion-scheduler.md`.

## Mobile, deep links y voz

`apps/mobile/app.config.ts` valida la variante, configura identifiers, scheme,
icon/splash placeholder y permisos iOS/Android. Un enlace tiene forma
`shopping-app-dev://join/CODE` (o scheme de staging/production). Anonymous Auth
se restaura desde SecureStore; desinstalar la app puede perder esa identidad
hasta que se vincule una cuenta.

En Ajustes se puede vincular o iniciar sesión con Google y Apple mediante OAuth
PKCE. La vinculación conserva la identidad anónima y sus datos; iniciar sesión
con una cuenta existente sustituye la sesión local después de mostrar una
advertencia. Para habilitarlo en cada proyecto Supabase remoto:

1. Activa **Enable Manual Linking** en Authentication > Providers.
2. Configura Google y Apple con sus credenciales propias del entorno.
3. Añade `shopping-app-dev://auth/callback`,
   `shopping-app-staging://auth/callback` o
   `shopping-app://auth/callback` a las redirect URLs permitidas según la
   variante desplegada.

Los secretos de Google y Apple nunca forman parte del bundle móvil. La
configuración local deja ambos proveedores desactivados hasta que existan
credenciales válidas.

Voz requiere development build y dispositivo con reconocimiento disponible.
Solo solicita permisos al empezar, muestra transcript/preview y añade únicamente
las líneas confirmadas. No persiste audio.

### Android

Build local de desarrollo:

```powershell
pnpm --filter @shopping-app/mobile android
```

Build EAS interno o production:

```powershell
pnpm dlx eas-cli login
Set-Location apps/mobile
pnpm dlx eas-cli init
pnpm dlx eas-cli build --platform android --profile staging
pnpm dlx eas-cli build --platform android --profile production
```

Antes configura en EAS las dos variables públicas Supabase del entorno. EAS
solicitará o reutilizará el keystore; conserva su custodia. Verifica el enlace
de invitación y voz sobre el AAB/APK resultante.

### iOS

En macOS, build local: `pnpm --filter @shopping-app/mobile ios`. Desde cualquier
host, EAS cloud:

```powershell
Set-Location apps/mobile
pnpm dlx eas-cli build --platform ios --profile staging
pnpm dlx eas-cli build --platform ios --profile production
```

Se necesita Apple Developer, bundle id registrado y certificados/provisioning.
EAS puede administrarlos con autorización. La publicación final requiere
metadatos, privacidad, icono de marketing definitivo y revisión en App Store
Connect; los assets actuales son placeholders técnicos.

## Admin

```powershell
Copy-Item apps/admin/.env.example apps/admin/.env
pnpm admin
```

Escucha en `127.0.0.1:4010`. Si se expone, usa proxy HTTPS, control de red y rate
limiting. Sus acciones usan RPCs service-role, registran `admin_audit_log` y
encolan refreshes; el navegador no llama providers.

## Tests y validación end-to-end

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm supabase:reset
pnpm supabase:test
pnpm exec supabase db lint --local --level warning
```

La suite cubre RLS, grupos/invitaciones, incrementos realmente concurrentes,
idempotencia, checked/broadcast, búsqueda, seed demo, comparación, offline replay
y voz. Los flujos de dos dispositivos, conectividad y micrófono se validan con
`docs/beta-e2e-checklist.md`.

Los tests live no forman parte del gate reproducible:

```powershell
$env:RUN_LIVE_PROVIDER_TESTS='true'; pnpm exec vitest run providers/dia/src/dia-provider.live.test.ts
$env:RUN_LIVE_PROVIDER_TESTS='true'; pnpm exec vitest run providers/mercadona/src/mercadona-provider.live.test.ts
$env:RUN_LIVE_PROVIDER_TESTS='true'; pnpm exec vitest run providers/eroski/src/eroski-provider.live.test.ts
```

También pueden lanzarse manualmente desde `provider-live-tests.yml`. Sus fallos
pueden reflejar cambios o bloqueos externos y deben degradar/pausar un provider,
no romper la demo local.

## Estado de beta y deuda

Completos: auth anónima, grupo/invite/join, lista compartida, cantidades
atómicas, checked, Realtime, outbox offline, búsqueda/ofertas, alta de producto,
preview/confirmación de voz y comparación con total/cobertura/no encontrados/
stale/promos.

Parciales: discovery de Alcampo, búsqueda live de Mercadona, recuperación
de identidad anónima tras desinstalar, telemetría UX de reintentos Realtime y
assets/metadata de store definitivos. Deuda adicional: retención de
`price_history`, breaker distribuido, checkpoint de catálogos grandes y Basic
Auth del admin. Auditoría ampliada: `docs/beta-hardening-audit.md`.

BLOCKERS para publicar fuera de un entorno controlado:

1. Crear y validar staging/production Supabase, habilitar anonymous auth, aplicar
   migraciones y configurar backups/alertas/secrets.
2. Vincular el proyecto EAS, configurar signing y variables por entorno.
3. Completar el checklist en dos dispositivos reales y ejecutar live tests de
   cada provider que vaya a declararse operativo.
4. Sustituir placeholders por assets de publicación y completar privacidad y
   fichas de stores.

## Checklist antes de publicar

- [ ] Working tree limpio; CI, lint, typecheck, unit/integration y pgTAP verdes.
- [ ] `db push --dry-run` revisado; backup y rollback operativo disponibles.
- [ ] RLS/anonymous auth/Realtime comprobados en el proyecto objetivo.
- [ ] Ningún secret aparece en bundle, logs, Git o `.env` versionado.
- [ ] Dos usuarios reales completan invitación, concurrencia, Realtime y offline.
- [ ] Búsqueda/comparación respetan postal code y explican stale/promos/cobertura.
- [ ] Voz probada concediendo, denegando y bloqueando permisos.
- [ ] Provider health coincide con ACTIVE/DEGRADED/DISABLED real.
- [ ] Android/iOS staging instalados; deep links y permisos verificados.
- [ ] Signing, backups, monitorización, soporte, privacidad y assets finales listos.

## Troubleshooting

- `Missing EXPO_PUBLIC...`: crea `apps/mobile/.env` y reinicia Metro con caché
  limpia (`pnpm --filter @shopping-app/mobile start -- --clear`).
- El móvil no conecta: `127.0.0.1` apunta al propio dispositivo; usa `10.0.2.2`
  en Android Emulator o la IP LAN y revisa firewall.
- Docker/Supabase no arranca: abre Docker Desktop, ejecuta
  `pnpm exec supabase status` y después `pnpm supabase:start`.
- El enlace abre otra variante: comprueba que `APP_ENV`,
  `EXPO_PUBLIC_APP_SCHEME` y el perfil EAS coinciden; recompila el binario.
- Voz no disponible en Expo Go: instala la development build.
- Outbox pendiente: recupera red, lleva la app a foreground y comprueba sesión;
  no borres los datos de la app antes de recoger logs.
- Comparador vacío: usa lista postal `50009`, ejecuta `pnpm supabase:reset` y
  añade el resultado canónico, no solo texto libre.
