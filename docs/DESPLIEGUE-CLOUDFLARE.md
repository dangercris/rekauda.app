# Despliegue en Cloudflare

Guía para instalar tu propia copia de Rekauda desde cero, en tu cuenta de Cloudflare. Tiempo estimado: entre 45 y 90 minutos la primera vez. Al terminar tendrás el sitio en tu dominio, el panel de tesorería funcionando y, si sigues también [CORREO-DEUNA.md](CORREO-DEUNA.md), la confirmación automática de pagos.

## Resumen del camino

| Paso | Qué haces | Dónde |
| --- | --- | --- |
| 1 | Cuenta, dominio y herramientas | Cloudflare y tu computador |
| 2 | Copiar el repositorio e instalar | Terminal |
| 3 | Crear base de datos (D1) y bucket (R2) | Terminal |
| 4 | Entender los archivos de configuración locales | Editor |
| 5 | Personalizar tu instancia (`rekauda.config.ts` y `wrangler.jsonc`) | Editor |
| 6 | Configurar secretos | Terminal |
| 7 | Migraciones, compilación y despliegue | Terminal |
| 8 | Dominio propio | `wrangler.jsonc` |
| 9 | Verificar | Terminal y navegador |

## 1. Requisitos

- Una cuenta de Cloudflare. El plan gratuito sirve para empezar; revisa los límites en la sección de costos.
- Un dominio administrado por Cloudflare (su DNS en Cloudflare). Es opcional para probar (hay una URL `workers.dev`), pero obligatorio para recibir correos de Deuna y para tener una dirección propia.
- Node.js 22 o superior y pnpm 9 o superior. El repositorio no fija versiones en `engines`; usa `@types/node` 22.
- `openssl` y `jq` (los scripts de revisión usan `jq`).
- Una cuenta de GitHub si vas a mantener tu copia en un repositorio propio.

## 2. Copiar e instalar

```bash
git clone https://github.com/<tu-usuario>/rekauda.app.git
```

```bash
cd rekauda.app
```

```bash
pnpm install
```

Si prefieres mantener tu copia en GitHub, haz primero un fork desde la web y clona el fork.

Inicia sesión en Cloudflare con Wrangler (se abre el navegador):

```bash
pnpm exec wrangler login
```

```bash
pnpm exec wrangler whoami
```

**Cómo verificar.** `wrangler whoami` muestra tu cuenta y su `Account ID`. Si tienes varias cuentas, anota la correcta.

## 3. Crear D1 y R2

Elige nombres propios (ejemplos: `miescuela-db` y `miescuela-comprobantes`).

```bash
pnpm exec wrangler d1 create miescuela-db
```

El comando imprime un `database_id` (formato UUID). Cópialo. Si Wrangler te ofrece agregar el binding automáticamente a tu configuración, responde que no: lo editaremos a mano.

```bash
pnpm exec wrangler r2 bucket create miescuela-comprobantes
```

**Cómo verificar.**

```bash
pnpm exec wrangler d1 list
```

```bash
pnpm exec wrangler r2 bucket list
```

El bucket debe ser privado (no actives acceso público ni dominio público en el panel de R2). Los comprobantes se sirven solo por el Worker.

## 4. Archivos de configuración de tu instancia

Todo lo propio de tu curso vive en dos archivos locales que **no están en git** (están en `.gitignore`). Se crean solos a partir de las plantillas la primera vez que ejecutas `pnpm dev:web`, `dev:api`, `build`, `test`, `typecheck`, `types` o `deploy` (`scripts/ensure-config.mjs`, que nunca sobrescribe un archivo existente). También puedes crearlos tú:

```bash
node scripts/ensure-config.mjs
```

| Archivo | Plantilla (sí está en git) | Qué es |
| --- | --- | --- |
| `rekauda.config.ts` | `rekauda.config.example.ts` | Datos del colegio, cuenta de cobro, bancos y analíticas |
| `wrangler.jsonc` | `wrangler.example.jsonc` | Cuenta de Cloudflare y recursos (D1, R2, dominio, límites de tasa) |

Edita siempre las copias, nunca las plantillas. Los scripts de `package.json` y de `scripts/` usan el binding `DB` de D1, así que no hay nombres de base que reemplazar a mano; `scripts/pending.sh` lee el nombre del bucket de `wrangler.jsonc` (`scripts/r2-bucket.mjs`).

## 5. Personaliza tu instancia

### Paso 1: editar `rekauda.config.ts`

Si el archivo tiene datos inválidos, el proyecto falla al cargar con un mensaje del tipo `Invalid rekauda.config.ts: <campo> ...` (reglas en `src/shared/instance-validation.ts`).

| Campo | Qué poner | Regla |
| --- | --- | --- |
| `schoolName` | Nombre de tu colegio. Aparece en el pie y en la tarjeta de vista previa | Texto no vacío |
| `className` | Nombre del curso, por ejemplo `"7.º de Básica B"` | Texto no vacío |
| `classShortName` | Forma corta para títulos de página y vista previa | Texto no vacío |
| `classMark` | Iniciales para la insignia del curso, por ejemplo `"7B"` | Máximo 3 caracteres |
| `treasury.bank` y `treasury.accountType` | Banco y tipo de cuenta que cobra | Texto no vacío |
| `treasury.accountNumber` | Número de cuenta, solo dígitos | Al menos 4 dígitos. Los últimos 4 se usan para reconocer los correos de Deuna |
| `treasury.holder` y `treasury.holderId` | Titular y su cédula | Texto no vacío |
| `treasury.deunaUrl` | Link de pago de Deuna, o `null` | `null` o URL `https://` |
| `treasury.qrUrl` | Ruta del QR, por ejemplo `"/deuna-qr.png"`, o `null` para ocultarlo | `null` o ruta que empiece con `/` |
| `treasury.helpUrl` | Artículo de ayuda de Deuna, o `null` | `null` o URL `https://` |
| `banks` | Lista de bancos y cooperativas del formulario | Sin vacíos ni repetidos |
| `earliestTransferDate` | Primera fecha de transferencia aceptada, formato `AAAA-MM-DD` (usa el inicio de tu primera recaudación) | Fecha válida |
| `defaultTone` | Color `#RRGGBB` propuesto al crear recaudaciones | Formato `#RRGGBB` |
| `analytics.gaMeasurementId` | ID de medición de Google Analytics 4 (por ejemplo `"G-ABC123XYZ9"`) o `null` | `null` apaga las analíticas por completo: sin aviso de cookies y sin cargar nada |

Los datos de `treasury` son públicos a propósito: las familias los necesitan para pagar. Con esta configuración también se generan los títulos de las páginas: el Worker los escribe al servir cada página y deja los datos en una etiqueta `#rekauda-config`, de donde los lee la aplicación (si falta, los pide a `/api/config`). Ya no se incrustan al compilar.

Las pruebas usan siempre la configuración de ejemplo (por un alias de Vitest), así que cambiar tu configuración real no las rompe.

**Cómo verificar.**

```bash
pnpm typecheck
```

```bash
pnpm test
```

### Paso 2: editar `wrangler.jsonc`

| Campo | Qué poner |
| --- | --- |
| `name` | Nombre de tu Worker, por ejemplo `miescuela-recaudos` |
| `account_id` | El de tu cuenta (de `wrangler whoami`). Es opcional si solo tienes una cuenta con sesión iniciada |
| `d1_databases[0].database_name` | El nombre que usaste en `d1 create` |
| `d1_databases[0].database_id` | El UUID que imprimió `d1 create`. Deja `binding` como `DB` |
| `r2_buckets[0].bucket_name` | El nombre de tu bucket. Deja `binding` como `RECEIPTS` |
| `ratelimits[*].namespace_id` | Un número en texto, único en tu cuenta y distinto para cada limitador. Cámbialos si ya los usas en otro Worker |
| `routes` y `workers_dev` | Ver paso 8 |

El binding `images` (`IMAGES`) no necesita configuración extra: convierte la tarjeta de vista previa a JPEG. Si en tu plan no está disponible, la tarjeta se entrega como PNG sin guardarse y la aplicación sigue funcionando.

### Paso 3 (opcional): imagen del QR

Si usas Deuna con QR, guarda la imagen exportada de la app en `public/deuna-qr.png` y deja `treasury.qrUrl` en `"/deuna-qr.png"`. El archivo tampoco está en git. Si no tienes QR, pon `treasury.qrUrl: null`; con un archivo faltante la página lo maneja sin romperse.

### Paso 4 (opcional): crédito del pie

El pie de la página pública incluye un crédito al autor del proyecto (`src/client/public/components/PageFrame.tsx`). Es el crédito del proyecto y se mantiene como parte del código abierto.

### Respalda tu configuración

`rekauda.config.ts`, `wrangler.jsonc` y `public/deuna-qr.png` no están en git. Guarda una copia en un gestor de contraseñas o en un lugar seguro. Si haces un fork público, nunca los subas.

### Otros elementos del repositorio

| Ruta | Qué es |
| --- | --- |
| `redirect/` | Worker opcional y heredado que solo sirvió para redirigir una URL antigua de la instancia original. No lo necesitas (ver `redirect/README.md`) |
| `src/client/gallery/` y `gallery.html` | Guía de estilos solo para desarrollo (`vite`), no se compila |

## 6. Secretos

Hay dos secretos obligatorios (`secrets.required` en `wrangler.jsonc`). Nunca van en archivos del repositorio.

| Secreto | Para qué |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña del panel `/admin` |
| `FORWARD_TO` | Correo real del tesorero que recibe copia de cada mensaje de Deuna. Debe ser una dirección de destino verificada en Email Routing (ver [CORREO-DEUNA.md](CORREO-DEUNA.md)) |

Cada `wrangler secret put` crea una versión y la despliega de inmediato. Si el Worker todavía no existe, Wrangler puede preguntarte si quieres crearlo con ese nombre: responde que sí.

```bash
pnpm exec wrangler secret put ADMIN_PASSWORD
```

Usa una contraseña larga y única. Wrangler la pide por entrada oculta. Si cambias `ADMIN_PASSWORD` más adelante, ingresa de nuevo al panel con la clave nueva: ese ingreso cierra las demás sesiones abiertas.

```bash
pnpm exec wrangler secret put FORWARD_TO
```

Escribe el correo del tesorero. Puedes dejarlo para cuando configures el correo de Deuna, pero el Worker necesita el secreto para desplegarse.

**Cómo verificar.**

```bash
pnpm exec wrangler secret list
```

Deben aparecer los tres nombres (nunca los valores).

Para desarrollo local, los mismos nombres van en `.dev.vars` (ver [README.md](../README.md)). Ese archivo está en `.gitignore`: no lo subas.

## 7. Migraciones y despliegue

```bash
pnpm run deploy
```

Usa `pnpm run deploy`, no `pnpm deploy`: este último es un comando propio de pnpm (para espacios de trabajo) y no ejecuta el script del proyecto. El script hace, en orden: aplica las migraciones remotas a tu D1, compila la aplicación con Vite y despliega el Worker.

Si prefieres hacerlo por partes:

```bash
pnpm db:migrate:remote
```

```bash
pnpm build
```

```bash
pnpm exec wrangler deploy
```

**Cómo verificar.** Wrangler imprime la URL, del tipo `https://<nombre>.<tu-subdominio>.workers.dev`. Ábrela: debe cargar la página de inicio con tu curso.

## 8. Dominio propio

En tu `wrangler.jsonc` la línea `routes` viene comentada desde la plantilla. Descoméntala y pon tu dominio:

```jsonc
"routes": [{ "pattern": "recaudos.tu-dominio.ec", "custom_domain": true }],
"workers_dev": true,
```

Requisitos y detalles:

- El dominio (zona) debe estar en la misma cuenta de Cloudflare. Con `custom_domain: true`, Wrangler crea el registro DNS y el certificado en el despliegue.
- Si ya existe un registro DNS para ese nombre (por ejemplo un `A` o `CNAME`), elimínalo antes: el despliegue falla si choca.
- **Cuidado con `workers_dev`.** Si defines `routes` y no escribes `"workers_dev": true` de forma explícita, Wrangler desactiva la URL `workers.dev` en el siguiente despliegue. Eso rompe los enlaces que ya compartiste con esa URL. La plantilla ya lo trae en `true`: déjalo así mientras necesites que siga viva, o ponlo en `false` solo cuando todos usen el dominio propio.
- Vuelve a desplegar con `pnpm run deploy`.

**Cómo verificar.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://recaudos.tu-dominio.ec/
```

Debe responder `200`. El certificado puede tardar unos minutos en emitirse.

## 9. Lista de verificación

Reemplaza `HOST` por tu dominio o tu URL `workers.dev`.

```bash
curl -s https://HOST/api/config
```

Debe devolver JSON con `className`, `schoolName`, `banks` y `treasury` con tus datos.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://HOST/api/collections
```

Debe responder `200`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://HOST/api/admin/session
```

Debe responder `401` (sin sesión). Un `503` significa que falta `ADMIN_PASSWORD`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://HOST/admin
```

Debe responder `200`.

- [ ] La página de inicio carga y muestra tu curso y tu colegio.
- [ ] En `/admin` puedes entrar con `ADMIN_PASSWORD`.
- [ ] Creaste una recaudación de prueba, subiste una portada y la ves en `/r/<enlace>`.
- [ ] Registraste un pago de prueba con un comprobante y aparece en el panel con estado `en_revision`.
- [ ] La consulta por código `XXX-XXX` funciona.
- [ ] La cuenta, el titular y el QR mostrados son los tuyos.
- [ ] La vista previa responde (reemplaza `ENLACE`):

```bash
curl -sI https://HOST/api/og/ENLACE.jpg
```

Debe responder `200` con `content-type: image/jpeg`. Después compártelo en WhatsApp para ver la tarjeta (WhatsApp guarda en caché las vistas previas).

- [ ] La lista de recaudaciones empieza vacía (las migraciones ya no crean ejemplos) y creaste la tuya desde `/admin`.
- [ ] Borraste el pago de prueba si lo registraste de verdad (ver [OPERACION.md](OPERACION.md)).

## Actualizar y volver atrás

Para actualizar tu copia con cambios del repositorio original, trae los cambios, revisa conflictos con tus archivos personalizados y vuelve a desplegar:

```bash
git pull
```

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm run deploy
```

Las migraciones nuevas se aplican solas en `deploy`. No edites migraciones ya aplicadas: crea una nueva en `migrations/`.

Para volver atrás un despliegue de código:

```bash
pnpm exec wrangler deployments list
```

```bash
pnpm exec wrangler rollback
```

El `rollback` revierte el código del Worker, no la base de datos. Las migraciones de D1 no se deshacen solas; si una migración fue el problema, corrígela con una migración nueva. Cambiar un secreto también crea una versión nueva.

## Costos y límites

Cloudflare cambia sus planes y precios. No copiamos cifras aquí: consulta las páginas de precios y límites de Workers, D1, R2, Images y Email Routing antes de lanzar. Puntos a revisar:

| Servicio | Qué revisar |
| --- | --- |
| Workers | Solicitudes por día y tiempo de CPU por solicitud en el plan gratuito. Generar la tarjeta de vista previa usa WebAssembly y es la operación más pesada |
| D1 | Almacenamiento y lecturas/escrituras. Un curso pequeño usa muy poco |
| R2 | Almacenamiento y operaciones. Cada comprobante pesa como máximo 5 MB |
| Images | Si la transformación está incluida en tu plan. Si no, la vista previa sale en PNG |
| Email Routing | Es gratuito según la documentación de Cloudflare; confírmalo |
| Observability (registros y trazas) | Cuota de eventos y retención de registros |

Prueba la ruta `/api/og/<enlace>.jpg` después de desplegar. Si falla por límites de CPU, la vista previa no aparece pero el resto de la aplicación sigue funcionando.

## Rekauda Cloud (multi-curso)

La rama `feat/cloud` usa `wrangler.cloud.jsonc` (copiado de `wrangler.cloud.example.jsonc`) y `migrations-cloud/`. Con `TENANCY = "multi"` resuelve cada curso por subdominio; con `TENANCY = "single"` funciona como una instalación de un solo curso, con `ADMIN_PASSWORD` y `FORWARD_TO`.

- En esta fase todo es local: `pnpm cloud:guard`, `pnpm cloud:migrate:local`, `pnpm cloud:seed:local` y `pnpm cloud:dev`. La guarda rechaza `--remote` y cualquier recurso compartido con otra instalación, y `deploy` y `db:migrate:remote` se niegan en esta rama.
- Cloud necesita una ruta comodín `*.<dominio>/*` con DNS `*` con proxy, un dominio remitente para `send_email`, un bucket `MAIL_ARCHIVE` con regla de 30 días y una regla catch-all de Email Routing en el subdominio de entrada (`INBOUND_DOMAIN`). Nada de eso está verificado: sigue la [lista de verificación en sandbox](CLOUD-SANDBOX-CHECKLIST.md) en un dominio aparte, nunca en el de una instalación en uso.

Para migrar un curso del piloto a Cloud (datos, correo y cambio del dominio raíz) sigue el runbook [MIGRACION-PILOTO.md](MIGRACION-PILOTO.md).

## Siguiente paso

[CORREO-DEUNA.md](CORREO-DEUNA.md) para la confirmación automática, y [OPERACION.md](OPERACION.md) para el uso diario.
