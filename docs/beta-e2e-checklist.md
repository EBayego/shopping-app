# Checklist E2E reproducible de beta

Este guion valida dos instalaciones independientes contra Supabase local o un
proyecto staging. El seed demo solo se carga con `supabase db reset`; no debe
ejecutarse en producción.

## Preparación

1. Ejecuta `corepack enable`, `pnpm install`, inicia Docker Desktop y después
   `pnpm supabase:start` y `pnpm supabase:reset`.
2. Obtén URL y anon key con `pnpm exec supabase status -o env` y crea
   `apps/mobile/.env` desde `apps/mobile/.env.example`.
3. Usa una URL alcanzable por ambos dispositivos. Android Emulator suele usar
   `http://10.0.2.2:54321`; un dispositivo físico necesita la IP LAN del host.
4. Genera/instala dos development builds. Borra los datos de ambas instalaciones
   para garantizar dos identidades anónimas distintas.
5. Mantén el código postal demo `50009` durante este guion.

## Usuario A, invitación y Usuario B

- [ ] A abre la app y llega a onboarding sin formulario de login.
- [ ] A crea el grupo “Casa beta”; aparece su lista inicial.
- [ ] A genera una invitación y comparte el enlace completo.
- [ ] B abre el enlace con la variante correcta (`shopping-app-dev://...` en
      development), completa anonymous auth y confirma la unión.
- [ ] A y B ven el mismo grupo y la misma lista.

## Colaboración y Realtime

- [ ] A añade “Pan”; B lo ve sin refresco manual.
- [ ] A y B pulsan `+` casi a la vez sobre el mismo producto; la cantidad final
      incorpora ambos incrementos.
- [ ] B marca el producto; A ve `checked` sincronizado.
- [ ] Poner la app en background y volver a foreground reconcilia el estado.

## Offline y convergencia

- [ ] A activa modo avión; la UI indica “Sin conexión”.
- [ ] A añade un producto, incrementa otro y cambia un `checked`.
- [ ] Los cambios siguen visibles localmente y el contador indica pendientes.
- [ ] A recupera conexión; el contador vuelve a cero sin duplicar operaciones.
- [ ] B ve los cambios y ambos dispositivos convergen tras foreground/reapertura.

## Catálogo demo y comparación

- [ ] Busca exactamente “leche semidesnatada”.
- [ ] Aparece “Leche semidesnatada 1 l”, SKUs de retailers y cuatro ofertas.
- [ ] La oferta DIA muestra promoción; Mercadona aparece `STALE`; Alcampo
      `VERY_STALE`; Eroski aparece no disponible.
- [ ] Añade el resultado canónico y también un texto libre “Producto imposible”.
- [ ] El comparador muestra retailers, total estimado, cobertura, el producto no
      encontrado y los indicadores stale/promoción.

## Voz (dispositivo compatible)

- [ ] Concede micrófono y reconocimiento de voz solo al solicitarlo.
- [ ] Dicta “dos leches semidesnatadas y un pan”.
- [ ] Se muestra preview editable; nada se añade antes de confirmar.
- [ ] Selecciona/confirma las líneas y aparecen en la lista.
- [ ] Denegar el permiso muestra una explicación recuperable y acceso a ajustes.

## Criterio de salida

No publicar si falla authentication/invite, se pierde algún incremento, el
outbox queda pendiente después de recuperar red, hay acceso cruzado entre grupos
o búsqueda/comparación exponen datos de otro código postal.
