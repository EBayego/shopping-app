# Auditoría de hardening pre-beta

Fecha: 2026-08-10. Alcance: monorepo TypeScript, CI, Supabase, providers,
ingestión, admin y aplicación móvil. No se ejecutaron provider live tests ni se
usaron credenciales reales.

## Resumen de severidad

- **BLOCKER:** ninguno abierto.
- **HIGH corregidos:** RPC de comparación de cesta inválida en runtime;
  desaparición de catálogo no conectada al pipeline y vulnerable a workers
  obsoletos; recuperación móvil que conservaba una sesión expirada; CI normal
  sin gate reproducible y sin exclusión estructural de tests live.
- **HIGH pendiente externo:** `image-size@1.2.1`, transitivo de Metro, tiene dos
  advisories de DoS en parsers ICNS/JXL/HEIF. El audit indica corrección en
  `>=2.0.3`, pero el registry solo publica hasta `2.0.2`. No se fuerza un major
  incompatible o inexistente. La exposición actual es de tooling durante el
  empaquetado de assets locales, no del runtime de la app. Reauditar al
  publicarse la corrección o al actualizar la línea compatible Expo/Metro.
- **MEDIUM/LOW:** detallados abajo.

## Cambios aplicados

### CI y quality gate

- Workflow de CI con Node 22, pnpm 11.20.0, frozen lockfile, lint, typecheck,
  tests unitarios/integración offline, Supabase local, reset completo de
  migraciones y pgTAP.
- Workflow manual separado para DIA, Mercadona y Eroski live. Los tests
  `*.live.test.ts` quedan excluidos por patrón del comando `pnpm test`.
- El scheduler existente y sus cambios locales previos no se reescriben.

### Supabase, ingestión y base de datos

- `get_basket_comparison_inputs` usa referencias no ambiguas; `db lint` pasa.
- La evidencia de desaparición se registra solo tras un catálogo completo,
  exactamente una vez por `provider_sync_run` activo.
- Un worker cuyo run haya expirado no puede incrementar misses. Tampoco se
  penalizan productos observados después de comenzar el run.
- La RPC anterior sin identidad de run pierde `EXECUTE` para `service_role`.
- Se mantienen las protecciones existentes: RLS, `search_path=''` en
  `SECURITY DEFINER`, RPCs privilegiadas solo para `service_role`, códigos de
  invitación aleatorios almacenados como hash, `SKIP LOCKED`, índice único de
  runs concurrentes, upserts idempotentes y protección por `observed_at`.
- Nuevas pruebas pgTAP cubren ACLs, idempotencia, leases obsoletos y ejecución
  real de comparación de cesta.

### Providers y secretos

- DIA, Alcampo y Eroski aceptan las dos formas estándar de `Retry-After`
  (segundos o fecha HTTP), además del soporte ya existente en Mercadona.
- Se confirmó timeout con `AbortController`, mapeo de 429, retry/backoff y
  circuit breaker en ingestión, parsing defensivo, errores de contrato,
  identidad de mercado y `observedAt` posterior a la respuesta.
- No aparecen API keys, cookies, sesiones, WAF tokens ni service-role reales en
  archivos versionados o commits inspeccionados. Fixtures DIA usan UUIDs
  sintéticos y los de Alcampo/Eroski están sanitizados.
- `.gitignore` bloquea HAR/PCAP/perfiles de navegador y se añade un ejemplo de
  entorno Alcampo con placeholders. `supabase/.temp` ya estaba ignorado y solo
  contiene secretos locales generados.

### Mobile

- La pérdida/expiración de sesión limpia caché y crea/restaura de forma
  single-flight una cuenta anónima nueva, evitando dobles sign-in.
- Fallos inesperados del coordinador offline quedan observados y actualizan el
  estado local en vez de producir una promesa rechazada sin manejar.
- Se verificaron SecureStore con `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, outbox SQLite
  idempotente, replay ordenado, reconciliación tras Realtime, recuperación al
  volver online, deep link de invitación y permisos/timeout/cancelación de voz.
- Se añadieron variantes Expo development/staging/production con identifiers y
  schemes independientes, perfiles EAS, permisos y placeholders técnicos.
- El enlace compartido usa el scheme de la variante instalada.

### Demo y validación end-to-end

- El seed local incluye un catálogo aislado para `50009` con búsqueda de leche
  semidesnatada, cuatro retailers, promoción, indisponibilidad y precios
  FRESH/STALE/VERY_STALE. No se aplica mediante `db push`.
- Un test pgTAP valida el seed a través de las RPC reales de búsqueda y
  comparación. Las aserciones de ingesta quedaron acotadas a su propio SKU para
  seguir siendo válidas con datos precargados.
- `docs/beta-e2e-checklist.md` cubre dos identidades, invitación, Realtime,
  concurrencia, offline/outbox, catálogo, comparación y voz en dispositivo.

## Riesgos pendientes

### MEDIUM

- `uuid@7.0.3` transitivo del CLI Expo tiene un advisory de bounds check. Solo
  se usa en tooling nativo; actualizar mediante una release compatible de Expo,
  no mediante override major sin validar.
- `price_history` crece sin política de retención/particionado. Definir antes
  de volumen sostenido una ventana de retención o partición temporal y métricas
  de crecimiento.
- El catálogo carga categorías con `Promise.all`; un fallo evita registrar
  desapariciones (comportamiento seguro), pero no ofrece checkpoint/reanudación
  por categoría y puede consumir memoria en catálogos grandes.
- Circuit breaker y límites de concurrencia viven por proceso/pipeline, no son
  distribuidos entre varios runners. La cola y el índice evitan runs duplicados
  por scope, pero no existe un breaker global por retailer.
- Cuenta anónima: al desinstalar o perder SecureStore no se puede recuperar la
  identidad hasta implementar linking Apple/Google/email. Debe comunicarse al
  usuario antes de beta pública.
- Realtime reconcilia al suscribirse y al volver la app al foreground, pero no
  expone estado de error/reintento al usuario. Supabase gestiona el backoff.
- Admin usa Basic Auth y escucha solo en loopback. Si se publica detrás de un
  proxy, exigir TLS, rate limiting y control de acceso de red en el despliegue.

### LOW

- Varias FK de auditoría (`created_by`, `added_by`, `matched_by`) no tienen
  índices dedicados. No afectan las rutas RLS críticas actuales; medir antes de
  añadir índices por volumen.
- GitHub Actions usa tags mayores oficiales (`@v4`) en vez de SHAs inmutables.
- Los tests React Native emiten el aviso de deprecación de
  `react-test-renderer`; no afecta al resultado, pero conviene migrarlos cuando
  el stack Expo ofrezca una alternativa compatible.
- El linter de Supabase CLI 2.110.0 avisa de que existe 2.113.0. Se mantiene la
  versión fijada del repositorio para reproducibilidad; actualizar en un cambio
  separado.

## Verificación

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` (263 tests offline; cero live incluidos)
- `pnpm exec supabase db reset --local` (migraciones desde cero + seed)
- `pnpm exec supabase test db` (202 assertions pgTAP)
- `pnpm exec supabase db lint --local --level warning` (cero hallazgos)
- `pnpm audit --audit-level=moderate` (los tres advisories transitivos
  documentados arriba)
