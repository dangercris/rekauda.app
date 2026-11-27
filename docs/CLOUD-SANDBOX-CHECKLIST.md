# Lista de verificación en sandbox de Rekauda Cloud

Esta lista se ejecuta **antes** de que Cloud salga a producción, en un dominio de pruebas aparte. Todo lo que aquí figura quedó sin verificar porque las pruebas automáticas usan dobles (D1 con `node:sqlite`, un `HTMLRewriter` falso, limitadores y correo simulados) y la rama `feat/cloud` nunca toca Cloudflare.

## Preámbulo de seguridad del piloto

- Nunca uses `rekauda.app` ni ningún recurso de la cuenta del piloto (worker, D1, R2, rutas, limitadores, Email Routing, DNS).
- Usa una cuenta o zona de pruebas distinta, con un dominio raíz propio (en esta guía, `sandbox.example.net`) y un subdominio de entrada (`in.sandbox.example.net`).
- La configuración vive en `wrangler.cloud.jsonc` (ignorado por git, copiado de `wrangler.cloud.example.jsonc`). Nunca uses `wrangler.jsonc` del piloto.
- `pnpm cloud:guard` debe pasar antes de cada paso. Rechaza cualquier nombre, id, bucket, ruta o limitador compartido con el piloto, y un comodín fuera de un dominio con `vars.SANDBOX = "true"`.
- Los scripts `cloud:*` pasan por `scripts/cloud-wrangler.mjs`, que rechaza `--remote`, `--config`, `--env` y `--persist-to`. En la fase 1 la guarda también rechaza `--remote`. Para ejecutar esta lista tendrás que usar `wrangler` a mano contra tu cuenta de pruebas, con los ids reales de la sandbox. Antes de cada comando verifica `wrangler whoami` y que el `--config` sea `wrangler.cloud.jsonc`. Nunca ejecutes `--remote` contra el piloto, y no uses `pnpm deploy` ni `pnpm db:migrate:remote` (se niegan en esta rama).
- `.pilot-resources.json` (ignorado por git, nunca se sube) es un archivo local opcional donde guardas los nombres, ids y dominios reales del piloto para que la guarda los rechace. Forma, con valores inventados: `{ "names": ["mi-worker", "mi-d1", "mi-bucket"], "ids": ["11111111-2222-3333-4444-555555555555"], "domains": ["ejemplo.invalid"] }`. El repositorio solo trae el patrón porque es público y no puede contener los nombres reales. Sin este archivo ni `wrangler.jsonc` local, la guarda solo avisa en modo local, y en la fase 1 `--remote` se rechaza siempre.
- Cada punto indica cómo deshacerlo. Al terminar, borra todos los recursos de la sandbox.

Formato de cada punto: **Hacer**, **Verificar**, **Esperado**, **Revertir**.

## 1. Rutas y DNS

### 1.1 Ruta comodín y DNS con proxy
- **Hacer**: en `wrangler.cloud.jsonc` agrega `vars.SANDBOX = "true"` y `routes: [{ "pattern": "*.sandbox.example.net/*", "zone_name": "sandbox.example.net" }]`. Crea un registro DNS `*` con proxy (nube naranja) en la zona de la sandbox y despliega a la sandbox.
- **Verificar**: `curl -sI https://demo-a.sandbox.example.net/` y `https://zzz.sandbox.example.net/`.
- **Esperado**: el primero responde 200 si existe el tenant `demo-a`; el segundo, 404 `not_found`. El certificado cubre el subdominio de primer nivel. El apex responde 404.
- **Revertir**: borra la ruta, el registro `*` y el worker de la sandbox.

### 1.2 `run_worker_first` con exclusiones `!`
- **Hacer**: usa `["/*", "!/assets/*", "!/icon.svg"]`.
- **Verificar**: `/assets/<bundle>.js` e `/icon.svg` salen directo de los assets (sin invocar el Worker, revisa los registros). `/`, `/admin`, `/r/<slug>` y `/api/assets/deuna-qr.png` pasan por el Worker.
- **Esperado**: el `*` cruza barras, así que `!/*.png` habría excluido también el QR de Deuna. Por eso las exclusiones son exactas.
- **Revertir**: vuelve a `["/*"]`.

## 2. Arranque de la página

### 2.1 `HTMLRewriter` real
- **Hacer**: abre `/`, `/admin` y `/r/<slug>` de un tenant con título y colores propios.
- **Verificar**: `curl -s https://demo-a.sandbox.example.net/r/<slug>` y revisa el HTML.
- **Esperado**: `<title>`, descripción y etiquetas OG del tenant; un solo `<script type="application/json" id="rekauda-config">` con la configuración pública, sin `<` sin escapar. El cliente monta sin pedir `/api/config`.
- **Revertir**: despliega el commit anterior.

### 2.2 CSP con el bloque JSON
- **Verificar**: consola del navegador sin violaciones de CSP en `/` y `/admin`; las cabeceras coinciden con `public/_headers` y `src/worker/og.ts`.
- **Esperado**: el bloque JSON no se ejecuta, así que no hace falta relajar la CSP.
- **Revertir**: no aplica; si falla, no despliegues.

## 3. Sesiones

### 3.1 Cookie `__Host-` en subdominios
- **Hacer**: inicia sesión en `demo-a` y luego visita `demo-b`.
- **Verificar**: DevTools, Application, Cookies.
- **Esperado**: `__Host-rk_session` con `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` y sin `Domain`, solo en el host de `demo-a`. `demo-b` no la recibe. Revisa Safari por separado. En `localhost` por http no se guarda: usa el flujo local del punto 9.
- **Revertir**: borra las sesiones del tenant (`DELETE FROM sessions` con el criterio del tenant de pruebas).

## 4. Correo saliente (enlaces mágicos)

### 4.1 `send_email` y dominio remitente
- **Hacer**: incorpora `sandbox.example.net` como dominio remitente y crea el binding `send_email`. El remitente es `no-reply@sandbox.example.net`.
- **Verificar**: solicita un enlace en `/admin` con el correo de un miembro. Confirma que `src/worker/mail/email-sender.ts` usa la forma estructurada `send({ from, to, subject, text })` aceptada por la API actual; revisa cuotas y límites en el panel.
- **Esperado**: llega el correo, con SPF, DKIM y DMARC en pass. Si la forma estructurada no existe, el cambio queda confinado a `CloudflareEmailSender`.
- **Revertir**: quita el binding y el dominio remitente.

### 4.2 Adjunto `.eml` (message/rfc822)
- **Hacer**: reenvía un correo de prueba de Deuna firmado (punto 5.4) para que se genere el aviso con adjunto.
- **Verificar**: que el adjunto llega, su tamaño máximo aceptado y la cuota diaria.
- **Esperado**: llega abierto como mensaje adjunto. Si se rechaza, el aviso debe degradarse a texto (hoy un fallo de envío queda registrado, no silencioso).
- **Revertir**: sin cambios persistentes.

### 4.3 Bandeja de spam
- **Verificar**: envía el enlace mágico y el aviso a Gmail, Outlook y un dominio propio.
- **Esperado**: bandeja de entrada, no spam. Si cae en spam, revisa el dominio remitente y el contenido antes de seguir.

### 4.4 Escáneres de correo
- **Hacer**: abre el correo con un cliente que precarga enlaces (o ejecuta `curl` sobre el enlace).
- **Verificar**: el enlace es `https://<host>/admin#acceso=<token>`; el token viaja en el fragmento.
- **Esperado**: el precargado no consume el token (el servidor nunca lo ve). Solo el clic de confirmación hace el `POST /api/admin/magic-link/verify`. Un segundo uso da 401 `invalid_link`.

## 5. Correo entrante (Deuna)

### 5.1 Catch-all en `INBOUND_DOMAIN`
- **Hacer**: habilita Email Routing en `in.sandbox.example.net` con **una** regla catch-all hacia el Worker de la sandbox. Nunca en el apex del piloto.
- **Verificar**: envía a `d-<token>@in.sandbox.example.net`, con un token de 16 a 64 caracteres de un tenant de pruebas.
- **Esperado**: `message.to` llega como `d-<token>@in.sandbox.example.net`. Un token desconocido se rechaza (`inbound_mail_rejected`) antes de leer el cuerpo.
- **Revertir**: desactiva la regla catch-all y Email Routing del subdominio.

### 5.2 Destinatario del sobre e invocación por destinatario
- **Verificar**: envía un mismo correo a dos tokens de tenants distintos y a un token más con CC.
- **Esperado**: una invocación de `email()` por destinatario del sobre, cada una con su tenant, sin mezcla de datos. Anota si `message.to` es el sobre o el encabezado `To`.

### 5.3 DKIM real extremo a extremo
- **Hacer**: reenvía un correo real de Deuna con datos inventados de prueba al token del tenant de la sandbox. La cuenta destino del tenant debe coincidir en los últimos 4 dígitos.
- **Verificar**: movimiento creado, vinculado y pago en `recibido` (la automatización nunca marca `pagado`). Un correo con From o DKIM alterados no crea nada y el aviso va solo en texto.
- **Esperado**: DKIM verificado una vez (`d=deunaapp.com`).
- **Revertir**: borra el movimiento de prueba y el objeto en `MAIL_ARCHIVE`.

### 5.4 `MAIL_ARCHIVE`: retención y cron
- **Hacer**: crea una regla de ciclo de vida de 30 días en el bucket de la sandbox y mantén `triggers.crons ["17 3 * * *"]`.
- **Verificar**: sube un `.eml` de prueba con fecha antigua bajo `t/<tenantId>/<día>/` y espera al cron, o ejecuta `scheduled()` con `wrangler dev --test-scheduled` en la sandbox. Busca `mail_archive_purged` en los registros.
- **Esperado**: los objetos de más de 30 días desaparecen. Un fallo se registra como `mail_archive_purge_failed` y no rompe el worker.
- **Revertir**: borra la regla y el cron.

### 5.5 Límite de avisos
- **Verificar**: envía correos en ráfaga a un token. Revisa `inbound_notice_capped`.
- **Esperado**: pasado el tope, no hay aviso pero el correo se archiva y se procesa. Si el limitador falla, no se envía aviso.

## 6. Limitadores reales

- **Hacer**: crea los tres `ratelimits` de la sandbox con namespaces propios.
- **Verificar**: `LOOKUP_LIMITER` (consulta pública, host desconocido `host-miss:<ip>`, aviso `inbound-notice:<tenantId>`) y `LOGIN_LIMITER` (`login:`, `ml:`, `mlv:`): repite hasta recibir 429.
- **Esperado**: 429 pasado el límite por ventana; una IP ausente (`cf-connecting-ip`) también da 429. Anota la ventana efectiva: el tope de avisos es por minuto, no por hora.
- **Revertir**: borra los namespaces de la sandbox.

## 7. D1

- **Hacer**: aplica `migrations-cloud` a la D1 de la sandbox con `wrangler d1 migrations apply` y el config de la sandbox.
- **Verificar**: inserta un pago con `tenant_id` y `collection_id` de otro tenant; ejecuta un `UPDATE` y revisa `meta.changes`.
- **Esperado**: la clave foránea compuesta rechaza el cruce (D1 siempre aplica claves foráneas). `meta.changes` es 1 en el consumo de un enlace y 0 en el segundo intento.
- **Revertir**: borra la base de la sandbox.

## 8. Antes de cerrar

- Repasa que ningún recurso, id o dominio de la sandbox quedó en archivos versionados (`git status`).
- Borra worker, D1, R2, rutas, DNS, Email Routing y dominio remitente de la sandbox.

## 9. Flujo local (`localhost`)

- **Hacer**: `pnpm cloud:migrate:local`, `pnpm cloud:seed:local`, `pnpm cloud:dev` (puerto 8799) y `pnpm dev:web` con el proxy a `demo-a.localhost`.
- **Verificar**: `http://demo-a.localhost:8799/` y `http://demo-b.localhost:8799/` muestran cursos distintos. Con `ROOT_DOMAIN=localhost` el enlace mágico usa http y la cookie `__Host-` puede no guardarse en algunos navegadores.
- **Esperado**: Vite acepta `*.localhost` y conserva el `Host`.
- **Revertir**: borra `.wrangler/state-cloud`.

## 10. Sandbox en workers.dev (misma cuenta)

Alternativa cuando solo tienes la cuenta de Cloudflare del piloto y ningún dominio de pruebas. El código es el mismo, pero se despliega como **dos Workers** que comparten **una** D1 y **un** bucket R2 propios de la sandbox. workers.dev da un hostname por Worker (`<nombre-del-worker>.<subdominio-de-la-cuenta>.workers.dev`), así que cada Worker se resuelve como un tenant de subdominio de la plataforma (slug igual al nombre del Worker).

**Qué se puede probar**: resolución de tenants por host, páginas públicas, aislamiento entre los dos tenants, recibos en R2, limitadores y migraciones de D1.

**Qué no se puede probar** (sigue necesitando un dominio aparte, secciones 1 a 5): rutas comodín, `send_email` y enlaces mágicos, correo entrante de Deuna y Email Routing, y el cron de purga. Por lo mismo, el **inicio de sesión del admin no es probable aquí**, porque el admin de Cloud usa enlaces mágicos. La sandbox de workers.dev no define `send_email`, `MAIL_ARCHIVE` ni cron.

**Reglas de seguridad** (las aplica `scripts/cloud-guard.mjs --sandbox`, que corre antes de cada comando remoto y de nuevo antes de cada proceso que se lanza; rechaza ante cualquier duda):

- Solo se usa `wrangler.sandbox.jsonc`, y solo se aceptan estas claves de primer nivel: `name`, `main`, `compatibility_date`, `compatibility_flags`, `workers_dev`, `preview_urls`, `account_id`, `assets`, `images`, `rules`, `d1_databases`, `r2_buckets`, `ratelimits`, `vars`, `observability`. Cualquier otra (`services`, `queues`, `routes`, `triggers`, `env`, `build`...) se rechaza.
- `vars.SANDBOX = "true"`, `TENANCY = "multi"`, `workers_dev = true`, `ROOT_DOMAIN` con la forma `<subdominio>.workers.dev`, una sola D1 (binding `DB`) y un solo bucket (binding `RECEIPTS`).
- Los nombres de los Workers, de la D1 y del bucket empiezan por `rekauda-sandbox-`. Ningún nombre ni id puede coincidir con los del piloto, en ninguna forma de escribir un id (con o sin guiones, con llaves, en mayúsculas). Solo `account_id` puede coincidir, porque es la misma cuenta.
- La guarda debe conocer los datos reales del piloto en tres categorías: un nombre de Worker, un id de D1 (UUID) y un bucket R2. Salen de tu `wrangler.jsonc` local y/o de `.pilot-resources.json` con esta forma, con valores inventados: `{ "workers": ["worker-piloto"], "d1Ids": ["11111111-2222-3333-4444-555555555555"], "buckets": ["bucket-piloto"], "ratelimitIds": ["1001"], "names": [], "ids": [], "domains": [] }`. Otras claves o tipos distintos se rechazan. Si falta una categoría, la guarda se niega a ejecutar comandos remotos.
- Un archivo de configuración con claves repetidas se rechaza.
- Los scripts `sandbox:*` no aceptan argumentos y lanzan wrangler con un entorno reducido (`PATH`, `HOME`, `TMPDIR`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NODE_ENV`): `CLOUDFLARE_ENV` y `WRANGLER_*` se descartan.

**Pasos manuales** (nada se crea automáticamente). Cada comando de `wrangler` lleva `--config wrangler.sandbox.jsonc`, y cada bloque empieza con `wrangler whoami` para confirmar la cuenta. Si `wrangler` ofrece escribir el binding en un archivo de configuración, responde **no**.

1. Crea la D1 y el bucket con nombres que empiecen por `rekauda-sandbox-` (la configuración debe existir antes, `pnpm sandbox:guard` la copia del ejemplo):

   ```
   wrangler whoami
   wrangler d1 create rekauda-sandbox-db --config wrangler.sandbox.jsonc
   wrangler r2 bucket create rekauda-sandbox-files --config wrangler.sandbox.jsonc
   ```

2. Completa `wrangler.sandbox.jsonc` (se copia de `wrangler.sandbox.example.jsonc` al correr cualquier script): `database_id` de la D1, `name` y `vars.SANDBOX_WORKERS` (dos nombres que empiecen por `rekauda-sandbox-`) y `vars.ROOT_DOMAIN` con el subdominio workers.dev de tu cuenta. Completa también los datos del piloto descritos arriba.
3. `pnpm sandbox:guard` (debe terminar en `OK (sandbox)`).
4. `pnpm sandbox:migrate` aplica `migrations-cloud` a la D1 de la sandbox.
5. `pnpm sandbox:seed` crea un tenant ficticio por Worker (Colegio Demo A y B) con datos inventados. Es idempotente y no crea usuarios, sesiones ni secretos.
6. `pnpm sandbox:deploy` compila una vez y despliega cada Worker con `--name`. `pnpm sandbox:status` lista los despliegues (solo lectura).
7. Verifica `https://<worker-a>.<subdominio>.workers.dev/` y `https://<worker-b>.<subdominio>.workers.dev/`: cada uno debe mostrar su curso.

**Revertir** (mismas reglas: `wrangler whoami` primero, `--config wrangler.sandbox.jsonc` siempre, y **no** a cualquier oferta de escribir bindings). Vacía el bucket antes de borrarlo. No toques ningún recurso del piloto.

```
wrangler whoami
wrangler delete --name rekauda-sandbox-a --config wrangler.sandbox.jsonc
wrangler delete --name rekauda-sandbox-b --config wrangler.sandbox.jsonc
wrangler d1 delete rekauda-sandbox-db --config wrangler.sandbox.jsonc
wrangler r2 bucket delete rekauda-sandbox-files --config wrangler.sandbox.jsonc
```

## Pendientes conocidos (no construidos)

- Herramienta de alta y rotación del token de entrada (`inbound_token`).
- Asistente de registro de cursos (fase 2) y cobro (fase 3).
- Plan de importación de los datos del piloto (tenant `pilot_import`, `r2_prefix=''`).
- Comparar más dígitos de la cuenta destino en el analizador congelado (hoy son los últimos 4).
- `testTimeout` de Vitest bajo carga (pruebas pesadas cerca de 5 s).
