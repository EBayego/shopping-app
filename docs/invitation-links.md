# Invitaciones y dominio shoppingapp.ebia.cloud

La app comparte `https://shoppingapp.ebia.cloud/join/001234`. El código se mantiene
como texto para conservar ceros iniciales. La app acepta tanto el código como
el enlace pegado en «Unirse con invitación». Los enlaces antiguos con el scheme
`shopping-app://` y los códigos anteriores siguen siendo válidos hasta caducar.

La migración `20261005100000_short_group_invites.sql` genera códigos aleatorios
de seis cifras. El cliente solicita siete días de validez y hasta 100 usos, como
antes. La unicidad del hash impide colisiones entre invitaciones activas, incluso
al generarlas simultáneamente. Un hash caducado puede reutilizarse para una nueva
invitación, reiniciando grupo, fecha de creación, caducidad y usos. Un enlace viejo
con un código reciclado se refiere a la nueva invitación; no se puede distinguir
su generación anterior con una URL que contiene solo el código.

## Publicar en el VPS de Hostinger

El VPS inspeccionado utiliza Docker Compose y Traefik, con la red externa
`privnetproxy`, el entrypoint HTTPS `websecure` y el resolver ACME `le`. El servicio
de invitaciones preparado en `tooling/invite-links/docker-compose.yml` usa esos
valores confirmados y reclama únicamente `shoppingapp.ebia.cloud`. Nginx sirve
archivos estáticos en el puerto interno 8080, sin publicar puertos del contenedor.
La imagen oficial se fija por digest. No requiere cambios en el proxy existente.

El DNS es **A shoppingapp → 194.164.72.105**, la IPv4 pública que ya
resuelve `ebia.cloud`. El directorio de despliegue es
`/home/ebayego/shoppingapp-invites`. Copia allí `docker-compose.yml`, `nginx.conf`
y el directorio `public` completo; ejecuta `docker compose config --quiet` y
`docker compose up -d invites`. Traefik solicita el certificado cuando el DNS está
disponible. La página no contiene secretos ni datos de grupos.

El 5 de octubre de 2026 se publicó el servicio y se verificaron HTTPS válido,
HTTP 200 para `/join/001234` y `/.well-known/assetlinks.json`, JSON servido con el
tipo correcto y redirección HTTP → HTTPS. El contenedor quedó saludable; los
otros cuatro servicios existentes conservaron sus ejecuciones.

La página permite abrir la app mediante su scheme y copiar el código. No consulta
Supabase ni añade miembros: la comprobación de caducidad y la unión ocurren en la
app usando la RPC autenticada existente. Tampoco necesita claves o secretos.

## Asociar el dominio con la APK / app iOS

Para que el sistema abra la app directamente al pulsar el enlace HTTPS, hay que
publicar las asociaciones del dominio y compilar una app que declare ese dominio.
`app.config.ts` ya añade Android App Links y iOS Associated Domains en producción.
Las variantes development/staging usan `/preview/join/CODE` y la página de respaldo,
con su scheme en el parámetro `scheme`. Esa ruta queda fuera de la asociación nativa
de producción para que esta no capture enlaces destinados a una variante de pruebas.

Obtén la huella SHA-256 del certificado **público** de la APK de producción. Por
ejemplo, con Android SDK Build Tools:

```powershell
apksigner verify --print-certs ruta-a-la-apk.apk
$env:INVITE_ANDROID_SHA256='HUELLA_SHA256_REAL_CON_32_PARES_HEXADECIMALES_SEPARADOS_POR_DOS_PUNTOS'
pnpm invites:associations
```

Si distribuyes también por Google Play con Play App Signing, añade la huella del
certificado de firma de la app de Play Console. Se pueden indicar varias huellas
separadas por comas. No uses la huella de la clave de subida cuando Play firma la
app con otra clave. No hacen falta el keystore, su contraseña ni una clave privada.

Para iOS, si se va a distribuir esta app:

```powershell
$env:INVITE_APPLE_TEAM_ID='TEAM_ID_REAL_DE_APPLE'
pnpm invites:associations
```

El generador valida los valores antes de escribir:

- `tooling/invite-links/public/.well-known/assetlinks.json`
- `tooling/invite-links/public/.well-known/apple-app-site-association`

Solo genera la plataforma para la que se hayan indicado datos. No se incluyen
certificados ni identificadores de ejemplo en los archivos públicos. Copia los
archivos generados al host y comprueba que se devuelven con HTTP 200 y
`Content-Type: application/json`, sin redirecciones ni autenticación.

La verificación utiliza los contratos documentados de
[Android App Links](https://developer.android.com/training/app-links/configure-assetlinks)
y [Apple Associated Domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains).

El `assetlinks.json` publicado ya contiene la huella pública extraída de la APK
de EAS `production-apk`, build `31818047-1d8b-426a-be1c-512dfc2b4b75`, identificador
`com.shoppingapp.mobile`, versionCode 3:

```text
5F:79:DB:E6:96:A2:C8:75:DF:F3:4A:22:0C:59:68:B0:E2:D9:FE:90:A6:A0:09:DD:9C:0F:69:21:8A:0E:CE:7A
```

Se leyó únicamente el certificado público del bloque de firma APK v2/v3, sin
descargar ni acceder al keystore o a claves privadas. Para iOS queda pendiente
indicar el Team ID real y generar/publicar su asociación.

Si se cambia el subdominio, configura `EXPO_PUBLIC_INVITE_BASE_URL` con la misma
URL HTTPS en EAS y en el entorno local **antes de recompilar**; la variable cambia
tanto los enlaces compartidos como la configuración nativa del dominio. La URL
predeterminada es `https://shoppingapp.ebia.cloud`.

## Backend y comprobación final

Aplica la migración en el Supabase de destino tras revisar el dry-run:

```powershell
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

La migración de este cambio ya se aplicó al Supabase vinculado el 5 de octubre de 2026. El dry-run previo mostró únicamente `20261005100000_short_group_invites.sql`;
no se aplicaron seeds ni otras migraciones.

Genera e instala una nueva APK con el perfil `production-apk`, como indica README.
Cambiar el dominio en JavaScript no actualiza el manifiesto de una APK instalada.
La compilación Android con `versionCode` 4 quedó iniciada en
[EAS Build](https://expo.dev/accounts/ebia/projects/shopping-app/builds/5a8e06ef-c01d-4cfd-b33b-0774ed4475a5)
el 5 de octubre de 2026. Su resultado y descarga se consultan desde ese enlace;
la APK todavía no se ha inspeccionado ni probado en un dispositivo.
Comprueba con un código recién generado:

- Pulsar el enlace desde WhatsApp abre el grupo en la app instalada.
- Con la app cerrada, la sesión se restaura antes de comprobar el código.
- Sin app instalada, se muestra la página y se puede copiar el código.
- Un enlace o código pegado en la app funciona igual, incluidos ceros iniciales.
- Un código caducado rechaza nuevas incorporaciones.

En Android, para comprobar la asociación después de publicar:

```powershell
adb shell pm verify-app-links --re-verify com.shoppingapp.mobile
adb shell pm get-app-links com.shoppingapp.mobile
```

La asociación Android con el certificado real ya está publicada. Falta instalar
la APK actualizada y comprobar la apertura automática en un dispositivo. La página
de respaldo funciona con los schemes de las APK existentes.
