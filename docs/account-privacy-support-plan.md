# Plan de eliminación de cuenta, privacidad y soporte

Fecha: 19 de octubre de 2026. Estado: propuesta de implementación basada en el
repositorio; este documento no implementa ni despliega las funcionalidades.

## Objetivo y alojamiento

Añadir tres accesos visibles en Ajustes: «Eliminar cuenta y datos», «Política de
privacidad» y «Contactar con soporte». Ofrecer además la solicitud de eliminación
desde un navegador, sin instalar ni abrir la app.

Se puede reutilizar la VPS de Hostinger. `docs/invitation-links.md` documenta el
despliegue de `shoppingapp.ebia.cloud` con Docker Compose, Traefik, HTTPS y Nginx.
La propuesta amplía ese servicio estático y mantiene el backend en Supabase:

```text
App móvil ───────────────────────────────┐
                                        ├─> función autenticada de Supabase
Web estática en la VPS ─> Supabase OAuth ┘        └─> Auth + limpieza en PostgreSQL
```

Rutas propuestas, todavía no implementadas:

| URL bajo `https://shoppingapp.ebia.cloud` | Uso                                               |
| ----------------------------------------- | ------------------------------------------------- |
| `/eliminar-cuenta/`                       | Información, autenticación y solicitud de borrado |
| `/privacidad/`                            | Política de privacidad pública en HTML            |
| `/soporte/`                               | Contacto y ayuda para problemas de acceso         |
| `/auth/callback/`                         | Retorno OAuth de la web, independiente del móvil  |

Se conservan `/join/*`, `/preview/join/*` y `/.well-known/*`. Las rutas nuevas
quedan fuera de los App Links y Universal Links de invitación. No es necesario
mover Supabase a la VPS ni crear otro dominio. Antes del despliegue hay que
comprobar que la configuración real del servidor sigue coincidiendo con la
documentación; en esta tarea no se ha inspeccionado la VPS por SSH.

## Situación encontrada

- App Expo/React Native con Expo Router, TypeScript estricto y pnpm 11.20.0.
- Supabase Auth permite identidades anónimas y vinculación/acceso con Google y Apple.
- Ajustes contiene nombre, apariencia y gestión de sesión. No se han encontrado
  las tres opciones solicitadas ni una función de eliminación de cuentas.
- Al borrar `auth.users`, las claves foráneas existentes eliminan perfil,
  membresías, invitaciones propias, operaciones privadas y cuotas de voz.
- La autoría de grupos, listas y productos de la lista se queda en `NULL`.
  Eso no borra por sí solo sus textos ni reasigna el rol de propietario.
- SQLite usa una caché y una cola globales, sin partición por usuario.
  `clearSyncedCache()` rechaza limpiar si hay operaciones pendientes.
  `SessionProvider` crea automáticamente una identidad anónima cuando desaparece
  la sesión. El borrado necesita coordinar estos comportamientos.
- El fallback offline devuelve caché incluso ante errores de autorización.
  Debe corregirse para que una cuenta eliminada desde la web no siga mostrando
  datos antiguos al volver a conectarse.
- Ya existen tests de Ajustes, OAuth, cierre de sesión, SQLite, sincronización,
  invitaciones y pgTAP. Se ampliarán en lugar de duplicar infraestructura.

## 1. Definir el alcance de los datos

Entregable: matriz de datos y política de borrado definida antes de implementar
la limpieza. Recomendación inicial:

| Datos                                                                        | Tratamiento propuesto                                                                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Usuario Auth, identidades, sesiones y perfil                                 | Eliminación definitiva                                                                                                |
| Membresías, invitaciones propias, operaciones privadas y cuota individual AI | Eliminación; reutilizar cascadas verificadas                                                                          |
| Grupo cuyo único miembro es quien se elimina                                 | Borrar grupo, listas y contenido dependiente                                                                          |
| Grupo compartido con otros miembros                                          | Conservar el acceso y los datos de los demás                                                                          |
| Propietario que abandona un grupo compartido                                 | Mantener otro propietario; si no existe, promover al miembro más antiguo con desempate por UUID                       |
| Autoría en datos compartidos                                                 | Retirar referencias al usuario eliminado                                                                              |
| Texto libre y productos añadidos por el usuario                              | Borrar sus productos/textos originales como opción inicial; revisar también nombres de grupos/listas y copias en JSON |
| Catálogo y precios de supermercados                                          | Conservar: son datos comunes del catálogo                                                                             |
| Caché, cola offline y credenciales del dispositivo                           | Limpiar al completar el borrado o detectar la revocación                                                              |
| Solicitudes, logs, copias de seguridad y proveedores                         | Inventariar y fijar finalidad, plazo y mecanismo de eliminación                                                       |

Conservar contenido compartido exige comprobar que no mantiene datos personales.
Cambiar `created_by` a `NULL` no equivale automáticamente a anonimizar. Hay que
revisar también textos e identificadores copiados dentro de operaciones de otros
miembros, logs y metadatos. Antes de publicar se debe concretar la regla para
nombres de grupos/listas y explicarla en la confirmación y en la política.

La transferencia de propiedad debe ocurrir en la misma operación transaccional
que la retirada de la membresía, con bloqueos para borrados simultáneos. No se
exigirá transferir manualmente un grupo para poder solicitar la eliminación.

## 2. Implementar el borrado real en Supabase

Entregables: nueva migración, función de backend, tipos regenerados y tests.

1. Crear una Edge Function de eliminación compartida por app y web; su nombre y
   contrato serán nuevos y se definirán al implementar.
2. Validar la sesión contra Supabase Auth en el servidor. Obtener de ella el UUID
   objetivo: el cliente no puede elegir qué usuario borrar ni autorizar mediante
   un correo o `user_metadata`. Admitir también al usuario anónimo autenticado.
3. Requerir una confirmación explícita mediante petición de escritura. Para las
   cuentas vinculadas, validar autenticación reciente; el navegador iniciará una
   sesión nueva con el mismo proveedor.
4. Ejecutar el borrado definitivo mediante `auth.admin.deleteUser`, con la clave
   administrativa exclusivamente en el servidor. No usar soft delete como
   sustituto de la eliminación solicitada.
5. Implementar la limpieza de dominio y propiedad con una función privada y un
   trigger asociado al borrado de Auth, validado primero en Supabase local.
   El objetivo es que la limpieza PostgreSQL y la eliminación de Auth se
   confirmen juntas o se reviertan juntas. Restringir permisos y `search_path`.
6. Confirmar si existen objetos de Storage en el entorno real. No se ha encontrado
   subida de archivos de usuario en la app revisada. Si los hay, borrarlos antes
   de Auth y gestionar los reintentos, pues Storage y PostgreSQL no comparten una
   única transacción.
7. Registrar el ciclo de la solicitud en almacenamiento privado con acceso solo
   del backend. Distinguir recibida, en proceso, completada y error/reintento;
   minimizar identificadores y fijar su purga. Incorporar un comprobante aleatorio
   no enumerable para consultar el resultado si la respuesta se pierde después
   de eliminar la sesión. No guardar tokens de acceso ni textos de listas.
8. Hacer idempotentes la recepción y el procesamiento. Una petición duplicada,
   un timeout o la ausencia final del usuario no deben dañar otros datos. Las
   solicitudes aceptadas deben poder finalizar aunque el cliente se cierre;
   prever un procesador de reintentos del backend con supervisión de errores.
9. No marcar «completada» hasta verificar el resultado definitivo. El comprobante
   y el estado deben seguir disponibles durante el plazo publicado tras borrar
   Auth, sin depender de la sesión eliminada.
10. Revisar revocación y JWT antiguos: borrar Auth no invalida inmediatamente un
    access token ya emitido. Validar sesión vigente en operaciones sensibles y
    comprobar RLS, RPCs y canales Realtime ya abiertos. La cuenta borrada no puede
    volver a leer datos personales, escribir ni reconstruir su perfil.
11. Revisar los broadcasts existentes: usan `broadcast_changes` con registros.
    Evitar que una suscripción previamente autorizada reciba datos personales
    después del borrado; considerar avisos mínimos de invalidación sin filas,
    porque el cliente actual ya vuelve a consultar al recibir eventos.
12. Limitar frecuencia, validar tamaños y origen web, y configurar CORS para los
    orígenes previstos. La autorización siempre depende de la sesión validada.

La [API administrativa de Supabase](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
documenta el borrado y la clave exclusiva del servidor. La
[gestión de usuarios](https://supabase.com/docs/guides/auth/managing-user-data)
explica las limitaciones de JWT y Storage que deben cubrir las pruebas.

## 3. Integrar las opciones en Ajustes

Entregables: accesos visibles y flujo completo de eliminación.

- Añadir «Política de privacidad» y «Contactar con soporte», accesibles también
  sin vincular Google/Apple y cuando falle la carga del perfil.
- Mostrar «Eliminar cuenta y datos» para la identidad actual, incluida la anónima.
- Antes de confirmar, explicar irreversibilidad, datos afectados, efecto en los
  grupos, plazos y tratamiento de cambios todavía no sincronizados.
- Exigir conexión para enviar la solicitud. Si no llega al backend, indicarlo;
  no mostrar éxito ni dejar un borrado ambiguo en el outbox de compras.
- Pausar nuevas escrituras y sincronización, y esperar o cancelar de forma
  controlada operaciones en curso antes del borrado. Permitir descartar cambios
  pendientes con confirmación específica, sin exigir sincronizarlos para borrar.
- Al terminar, cerrar canales, limpiar caché de consultas, SQLite, cola y secretos
  de sesión. La limpieza debe afectar a la identidad eliminada, nunca a la de
  otra cuenta que haya iniciado sesión durante el proceso.
- Particionar caché y outbox por usuario, incluyendo su migración desde el formato
  actual. No adjudicar colas antiguas de procedencia incierta a una cuenta nueva.
- Coordinar `SessionProvider` para mostrar el resultado y una acción voluntaria
  de volver a empezar antes de crear otra identidad anónima.
- Si el borrado se realiza desde la web, detectar sesión revocada al recuperar
  conexión o volver a primer plano, purgar datos de esa identidad y no usar caché
  como fallback ante falta de permisos. Un dispositivo sin conexión no puede
  recibir una orden remota de borrado hasta que vuelva a conectarse.

## 4. Añadir la web en la VPS

Entregables: HTML público, pequeño cliente de autenticación y configuración de
rutas dentro del servicio existente `tooling/invite-links`.

- Identificar la app/desarrollador con el nombre real de Play Console. Mostrar
  claramente qué se elimina, qué se conserva, durante cuánto tiempo y cómo pedirlo.
- Ofrecer acceso con el mismo Google/Apple vinculado a la app, intercambio PKCE
  en el navegador, confirmación y llamada a la misma función de eliminación.
- Autorizar la URL exacta de retorno web en Supabase y verificar la configuración
  efectiva de ambos proveedores. No enviar ese retorno al scheme móvil.
- Usar únicamente URL y clave pública de Supabase en el cliente web. Empaquetar
  el código con dependencias fijadas; no añadir un framework completo para estas
  páginas ni guardar una clave administrativa en HTML/JavaScript.
- No iniciar sesión anónima automáticamente en la web para intentar localizar
  la cuenta del móvil: generaría una identidad diferente. Tampoco asumir que un
  nuevo login social siempre corresponde a una cuenta preexistente.
- Añadir «No puedo acceder a mi cuenta» con contacto real y procedimiento asistido
  que pueda iniciarse sin instalar la app. No pedir contraseñas ni borrar cuentas
  basándose solo en un correo, UUID o código de invitación aportado por cualquiera.
- Explicar el caso de una identidad anónima cuya sesión se ha perdido: no existe
  un proveedor con el que recuperarla. El canal asistido puede recibir la petición,
  pero debe verificar titularidad; no se prometerá recuperación o identificación
  automática sin prueba. Decidir un mecanismo de recuperación/borrado verificable
  para este caso antes de dar por cerrado el flujo de identidades anónimas.
- No realizar borrados mediante GET, carga de enlaces o retorno OAuth automático.
- Mantener las páginas legales públicas; limitar caché de las respuestas de cuenta
  y evitar registrar credenciales. Comprobar HTTPS y enlaces desde móvil/escritorio.

## 5. Publicar privacidad y habilitar soporte

Entregables: política con datos reales, buzón operativo y página de ayuda.

- Elegir y probar un correo de soporte. Hostinger VPS no implica disponer ya de
  buzón o SMTP; se puede utilizar un buzón existente. No se necesita montar un
  servidor de correo en la VPS para ofrecer soporte.
- En Ajustes, abrir el compositor mediante `mailto:` con asunto y versión de la
  app, permitiendo revisar el mensaje. Mostrar/copiar la dirección y ofrecer la
  página web si el dispositivo no tiene cliente de correo. No enviar automáticamente.
- Definir quién atiende solicitudes sin acceso, cómo verifica identidad, cómo
  ejecuta el mismo borrado de backend y cómo comunica su finalización.
- Redactar privacidad a partir del inventario real: responsable y contacto,
  cuenta/perfil, grupos/listas y código postal, almacenamiento local, Supabase,
  proveedores sociales, soporte, seguridad, conservación, borrado y derechos.
- Describir fielmente la voz: reconocimiento nativo y sus posibles servicios del
  sistema; con AI activado se envía texto a OpenAI. No afirmar que `store: false`
  garantiza retención cero ni que toda la voz se procesa siempre offline.
- Revisar configuración y condiciones reales de los proveedores para reflejar
  conservación, solicitudes de borrado y copias de seguridad. Definir cómo se
  reaplicarán borrados si se restaura un backup. No prometer plazos no comprobados.
- Publicar HTML sin login, restricciones geográficas ni PDF y enlazarlo desde
  Ajustes y Play Console, conforme a la
  [política de datos de usuario](https://support.google.com/googleplay/android-developer/answer/10144311).

## 6. Verificar y desplegar

Orden: decisiones de datos/contacto, backend local, integración móvil y web,
pruebas en staging, despliegue del backend y páginas, build móvil y Play Console.

Pruebas de aceptación necesarias:

1. Borrado completo desde móvil para cuenta anónima, Google y Apple; repetición
   desde web sin tener la app instalada para cuentas recuperables.
2. Ausencia real de Auth/perfil/datos asociados; comprobación de textos libres,
   tablas privadas, JSON, Storage si existe y referencias indirectas.
3. Miembro normal, propietario único, varios propietarios, grupo de un miembro
   y borrados simultáneos. Los demás conservan acceso y un propietario válido.
4. Token ausente/caducado/ajeno, UUID manipulado, permisos de tablas/funciones,
   JWT previo al borrado y canal Realtime que ya estuviera abierto.
5. Doble pulsación, timeout tras commit, error parcial, recuperación mediante
   comprobante y reintento aunque se cierre el cliente.
6. Outbox pendiente o en curso, cambio de cuenta, app reiniciada, borrado desde
   navegador con otro dispositivo abierto y reconexión después de estar offline.
7. Privacidad y soporte visibles aunque falle el perfil; correo con/sin cliente
   instalado; recepción y respuesta reales; ruta asistida sin autenticación.
8. HTTP 200/HTTPS para páginas y callback; regresión de `/join/*`,
   `/preview/join/*` y asociaciones Android/iOS.

Comandos del proyecto para la implementación:

```powershell
pnpm test
pnpm lint
pnpm typecheck
pnpm supabase:test
pnpm mobile:bundle-check
```

Además: regenerar tipos tras la migración, revisar permisos/advisors y ejecutar
pgTAP en Supabase local. Validar `docker compose config --quiet` y hacer smoke
tests HTTP al desplegar las páginas. Los tests unitarios no sustituyen una
prueba de borrado real con cuentas desechables en staging.

Antes de publicar en Google Play, registrar la URL de eliminación y de privacidad,
y actualizar Seguridad de los datos para que coincida con la app y sus proveedores.
Google exige una ruta en la app y otra web que funcione sin reinstalarla; la página
debe identificar la app y permitir iniciar la solicitud. Véase el
[requisito de eliminación](https://support.google.com/googleplay/android-developer/answer/13327111?hl=es).

El despliegue se considera terminado cuando funcionan las dos vías de borrado,
el backend se ha verificado, soporte recibe mensajes y los enlaces constan en
Play Console. Un rollback de código no debe restaurar cuentas ni datos borrados.

## Archivos previstos y decisiones pendientes

| Área                      | Archivos principales existentes o nuevos previstos                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ajustes y sesión          | `apps/mobile/app/settings.tsx`, `features/auth/session-provider.tsx`, `repositories/auth-repository.ts`      |
| Caché y sincronización    | `apps/mobile/offline/*`, `features/groups/realtime.ts`                                                       |
| Borrado servidor          | Nueva función en `supabase/functions`, nueva migración y tests en `supabase/tests/database`                  |
| Tipos                     | `packages/database/src/database.types.ts`                                                                    |
| Web/VPS                   | `tooling/invite-links/public/*`, `nginx.conf` y configuración de build/Compose si hace falta                 |
| Configuración y operación | `supabase/config.toml`, ejemplos de variables, `README.md`, `docs/invitation-links.md`, checklist de staging |

Falta concretar: correo real y responsable del tratamiento; nombre exacto de la
ficha de Play; regla para textos compartidos y transferencia automática; solución
para solicitudes anónimas sin sesión; plazos de soporte, comprobantes, logs,
proveedores y backups; y configuración efectiva de OAuth/Supabase/VPS.

Esas decisiones afectan a la implementación y al contenido público. No impiden
preparar migraciones, pruebas y pantallas con configuración separada, pero deben
resolverse antes de publicar el flujo como completo.
