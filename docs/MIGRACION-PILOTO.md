# Migración del piloto a Rekauda Cloud

Runbook para pasar un curso del piloto (un Worker, una D1 y un bucket R2 propios) a un tenant de Rekauda Cloud, y mover el dominio raíz al final. Es un documento único y se ejecuta en orden.

Qué hace cada cosa. Los scripts de este repositorio (`pnpm prod:*` y `pnpm pilot:*`) aplican la guarda, piden una frase escrita y son la única vía a Cloudflare. **Dos de ellos sí cambian rutas**: `prod:deploy` y `prod:switch-apex` despliegan el Worker con las rutas del archivo de configuración, y `prod:switch-apex` es el script que toma el apex. Todo lo demás de la zona (DNS, Email Routing, SPF y DKIM, dominios personalizados, borrar una ruta, rutas de exclusión) es **MANUAL** en el panel de Cloudflare y lo revisa una segunda persona.

Convenciones: `<dominio-raiz>` es el dominio de producción, `<slug-del-curso>` el slug del tenant, `<ruta-heredada>` la ruta antigua del piloto (`/r/<slug-heredado>`), `<workdir>` el directorio privado que crea `pilot:export`. Los ejemplos usan `colegio-demo` y dominios `example.test`, nunca datos reales. Este documento no contiene secretos, ids ni nombres reales y no debe recibirlos.

Cada paso indica **Responsable**, **Hacer**, **Verificar** y **Revertir**. Cada fase termina con compuertas **Go** y **No-go**: un solo No-go detiene la migración.

## Nunca

1. Nunca ejecutes `wrangler` con `--remote`, ni `wrangler deploy`, fuera de los scripts. Única excepción: las sondas P0.2 sobre recursos de la sandbox (sección 1.2), con `wrangler whoami` primero y `--config` de la sandbox.
2. Nunca agregues `-y` ni contestes por tu cuenta una confirmación de wrangler. Si algo pregunta, es un No-go: detente y decide con el revisor.
3. Nunca importes dos veces el mismo plan. Si un import falló a medias, primero `prod:undo-data` (sección 5).
4. Nunca edites `manifest.json`, `import.sql` ni `tenant.json` después de `pilot:import:plan`. Si cambia algo, rehaz el plan.
5. Nunca deshagas (`prod:undo-*` ni SQL a mano) cuando el import ya está en vivo, es decir, cuando alguna familia pagó en Cloud. Concilia a mano (sección 5).
6. Nunca borres otro prefijo `t/<otro-id>/` del bucket, ni una carpeta completa. Borra solo la clave exacta.
7. Nunca ejecutes el "Revertir" de la [lista de la sandbox](CLOUD-SANDBOX-CHECKLIST.md) contra producción: borra Workers, D1 y buckets enteros.
8. Nunca pegues un token, una frase de acceso o el contenido de `handover.txt` en un chat, un ticket o un archivo del repositorio.
9. Nunca ensayes con un export real: el ensayo usa `pnpm pilot:demo-workdir` (sección 1.6).

## 0. Antes de empezar

### 0.1 Requisitos

1. Responsable: dueño. Node >= 22.18 (`node -v`). Con un Node anterior, `pnpm prod:guard` se niega con un mensaje claro. Los demás scripts `prod:*` y `pilot:*` muestran un error crudo de Node (módulo o `node:sqlite` no encontrado): es la misma causa, cambia de Node.
2. Responsable: dueño. Crea en la cuenta de producción, desde el panel, la D1, el bucket de recibos, el bucket de correo (con la regla de 30 días) y los tres espacios de nombres de limitadores, todos con prefijo `rekauda-cloud-` en el caso de nombres. Los pasos y los permisos están en la [guía de despliegue](DESPLIEGUE-CLOUDFLARE.md) (sección 3 y "Rekauda Cloud"). Anota los ids para el archivo del punto siguiente.
3. Responsable: dueño. Copia a mano `wrangler.production.example.jsonc` a `wrangler.production.jsonc` (ignorado por git, nunca se copia solo) y completa tus valores, **incluido `account_id`** (la guarda no lo exige, pero sin él el punto 7 de esta sección no se puede cumplir). La guarda acepta estas claves de primer nivel y rechaza cualquier otra: `name`, `main`, `compatibility_date`, `compatibility_flags`, `workers_dev`, `preview_urls`, `account_id`, `assets`, `images`, `rules`, `d1_databases`, `r2_buckets`, `ratelimits`, `vars`, `observability`, `routes`, `send_email`, `triggers`. Además: Worker, D1 y buckets con prefijo `rekauda-cloud-`, exactamente 3 limitadores, ids reales (los de ceros se rechazan), nada que coincida con el piloto ni con la sandbox, `vars` solo `TENANCY`, `ROOT_DOMAIN`, `INBOUND_DOMAIN` y `LEGACY_REDIRECTS`, y `routes` solo el comodín `*.<dominio-raiz>/*` (más una entrada del apex en la fase 2).
4. `LEGACY_REDIRECTS` es un **objeto JSON** (no una cadena) y va solo en este archivo. Una entrada con valor exacto `https://<slug>.<dominio-raiz>/r/<mismo-slug>`. El slug heredado es igual al slug del tenant, tiene 3 o más caracteres, no contiene `--` y no es reservado (`www`, `api` y similares se rechazan). Se agrega en la fase 2, no antes:

   ```jsonc
   "LEGACY_REDIRECTS": { "/r/curso-demo": "https://curso-demo.colegio-demo.example.test/r/curso-demo" }
   ```

5. Responsable: dueño. Crea `.pilot-resources.json` en la raíz del repositorio (ignorado por git, nunca se sube). Debe traer las ocho claves, con `productionRoot` obligatorio e igual a `ROOT_DOMAIN` de producción. Forma, con valores inventados:

   ```json
   { "workers": ["worker-piloto"], "d1Ids": ["11111111-2222-3333-4444-555555555555"], "buckets": ["bucket-piloto"], "ratelimitIds": ["1001"], "names": [], "ids": [], "domains": [], "productionRoot": "colegio-demo.example.test" }
   ```

   El nombre, el id y la cuenta de la D1 del piloto salen del `wrangler.jsonc` local del piloto (una sola D1). Nunca se imprimen.
6. Responsable: dueño. Dos tokens de API distintos, con el alcance mínimo, usados solo para estos comandos y **revocados al terminar la migración**. Para `pilot:export`: solo lectura de D1 de la cuenta del piloto (la herramienta no puede verificar los permisos del token, tú sí). Para `prod:*`: despliegue de Workers, D1 y R2 de la cuenta de producción y rutas de la zona, nada más. Los dos entran por la misma variable, `CLOUDFLARE_API_TOKEN`, así que **ejecuta `unset CLOUDFLARE_API_TOKEN` entre un paso y el siguiente** y cárgala solo para el comando que la necesita, leyéndola de tu gestor de secretos (nunca en un archivo ni en el historial de la terminal).
7. Responsable: dueño. Antes de escribir **cualquier** frase, lee la línea que imprime el script, `worker=... account=... root=...`, y confirma que el Worker empieza por `rekauda-cloud-`, que la cuenta es la de producción esperada y que la raíz es `<dominio-raiz>`. Si dice `account=(not set)` o algo distinto, no escribas la frase.
8. Piden una **frase escrita en una terminal** (TTY) todos los scripts de la sección 4 salvo `prod:guard`, `prod:status`, `pilot:cleanup`, `pilot:import:plan` y `pilot:demo-workdir`. Sin terminal se niegan.

### 0.2 Cuándo migrar

No migres con una recaudación abierta y con fecha límite cercana. **El piloto no tiene ningún mecanismo para congelar escrituras**: nada impide que una familia pague o que llegue un correo de Deuna mientras migras. Elige una ventana en que no haya ninguna recaudación abierta y no se esperen correos de Deuna, y avisa a tesorería que no revise pagos en el piloto durante las fases 1 y 2. Si algo entra igual, el export final lo detecta (MISMATCH) y se rehace todo (sección 2, paso 9).

### 0.3 Datos personales en el workdir

El `<workdir>` guarda los exports completos: nombres y teléfonos de familias, nombres de alumnos, montos y la cuenta de tesorería. Trátalo como un dato personal:

1. Disco con cifrado completo (FileVault, BitLocker o LUKS) en la máquina que migra.
2. Sin copias de seguridad ni sincronización del directorio temporal: exclúyelo de Time Machine y de cualquier nube.
3. Un reinicio puede vaciar el directorio temporal. Si eso pasa, el workdir se pierde y `prod:undo-*` se niega: queda solo la vía manual de la sección 5.
4. Se borra con `pnpm pilot:cleanup <workdir>` en el momento que indica la sección 6 (punto 1), no antes ni mucho después.

## 1. Fase 0: preparar Cloud

Responsable: dueño, con revisor para todo paso manual. **Esta fase sí cambia la zona viva** (DNS comodín, Email Routing de `in.`, SPF y DKIM) aunque no toca los recursos del piloto ni el apex. Cada cambio tiene ventana, verificación y reversa.

### 1.1 Inventario (P0.5)

1. Responsable: dueño, MANUAL. Exporta el inventario de la zona: registros DNS, rutas de Workers, dominios personalizados, reglas de Email Routing y direcciones, reglas de redirección y de página, y el SPF (TXT) actual.
2. Confirma que el apex del piloto es un **dominio personalizado** del Worker del piloto (panel del Worker, "Domains & Routes", tipo Custom domain) y no una ruta. Si es una ruta con el mismo patrón que la de Cloud, la precedencia cambia: No-go hasta decidir con el revisor.
3. P0.5. El comodín `*.<dominio-raiz>/*` captura todo subdominio con proxy existente, también los que tienen dominio personalizado. Go: ningún subdominio con proxy queda bajo el comodín, o cada uno tiene una **ruta de exclusión "sin Worker" creada a mano en el panel** (no puede vivir en `wrangler.production.jsonc`, porque la guarda solo admite el comodín y una entrada del apex). No-go: hay un host con proxy sin cubrir. No crees el comodín.

### 1.2 Sondas del dueño (P0.1 y P0.2)

Cada sonda se ejecuta a mano, nunca un agente. Usan **solo recursos de la sandbox** o pasos del panel marcados así, con hosts de prueba `cd-probe-<aleatorio>` y entrada cerrada (`< /dev/null`) como la lanzan los scripts. Antes de cada comando de wrangler: `wrangler whoami` y `--config` apuntando a la configuración de la sandbox. Anota el resultado al lado (fecha, resultado, decisión). Un No-go detiene la migración hasta que el dueño y el revisor decidan por escrito.

**P0.1 La ruta gana al dominio personalizado.** Solo panel (MANUAL).
- Hacer: asocia el host `cd-probe-<aleatorio>.<dominio-raiz>` como dominio personalizado de un Worker de la sandbox A y agrega la ruta `cd-probe-<aleatorio>.<dominio-raiz>/*` hacia un Worker de la sandbox B. Pide el host con `curl -sI`.
- Verificar: Workers Logs muestran qué Worker respondió.
- Go: responde el Worker de la ruta. Entonces la ruta `<dominio-raiz>/*` toma el apex sin tocar al piloto. Si el panel acepta la ruta, queda un último punto que solo se ve en el cambio real: que `prod:switch-apex` no sea rechazado por Cloudflare. Si lo rechaza, el apex no cambió (verifícalo con el panel y con `curl`) y se usa la alternativa de la sección 3.4.
- No-go: responde el dominio personalizado o el panel rechaza la ruta. Usa la alternativa de la sección 3.4 y ajusta la fase 2 antes de seguir.
- Revertir: borra la ruta y el dominio de prueba.

**P0.2 `wrangler d1 execute` y R2 sin terminal.** Con la D1 y el bucket de la sandbox y un config generado en un directorio temporal (`account_id` y una sola entrada `d1_databases`, sin otro config en el árbol).
- (a) Forma del resultado: `wrangler d1 execute <nombre-d1> --remote --json --config <generado> --command "SELECT 1 AS a; SELECT 2 AS b;"`. Go: un arreglo JSON con una entrada por sentencia, en orden, cada una con `success: true` y `results`. No-go: una sola entrada o un error. `pilot:export` depende de esa forma: se detiene el proyecto y se cambia a cuatro SELECT separados (cambio de código).
- (b) Resolución: Go si resuelve la D1 por nombre con `--config <generado>` y la cuenta del config, sin preguntar. No-go si pide elegir cuenta o base.
- (c) `--file`: crea una tabla de prueba y un archivo con un INSERT válido seguido de otro que falla (tabla inexistente). Ejecuta `wrangler d1 execute <nombre-d1> --remote --config <generado> --file <archivo>`. Registra si queda la primera fila (no atómico) o no (atómico). Cualquiera de los dos es Go, porque la seguridad no depende de ello: el import solo arranca con cero filas y `prod:undo-data` limpia. Si pide confirmación y se queda esperando, es No-go: no agregues `-y`.
- (d) `wrangler r2 object put <bucket-sandbox>/t/prueba/assets/x.png --file <png> --content-type image/png --remote --config <generado>`. Go: sube sin preguntar y toma la cuenta del config. Verifica con `wrangler r2 object get ... --remote --config <generado> --file <destino>`. No-go: pide confirmación o usa otra cuenta.
- Revertir: borra la tabla y el objeto de prueba.

### 1.3 Despliegue de Cloud (P0.6)

1. Responsable: dueño, MANUAL con revisor. Con P0.5 en Go: registro DNS `*` AAAA `100::` con proxy. Ventana: cualquiera, no afecta hosts con registro propio. Verificar: `curl -sI https://zzz.<dominio-raiz>/` llega a Cloud o responde 404 de Cloud tras el paso 2, y los subdominios del inventario siguen igual. Revertir: borra el registro `*`.
2. Responsable: dueño. `pnpm prod:guard` debe terminar en OK. Luego `pnpm prod:migrate` (frase `MIGRATE PRODUCTION`) y `pnpm prod:deploy` (frase `DEPLOY PRODUCTION`), leyendo antes la línea `worker=... account=... root=...` (sección 0.1, punto 7). Verifica con `pnpm prod:status`. Revertir: borra la ruta o el Worker en el panel.
3. **P0.6 `wrangler deploy` y las rutas creadas a mano.** MANUAL. Crea en el panel una ruta de exclusión "sin Worker" para un host de prueba `cd-probe-<aleatorio>.<dominio-raiz>/*` y ejecuta de nuevo `pnpm prod:deploy` (frase `DEPLOY PRODUCTION`). Verificar: ¿sigue la ruta en el panel? Go: sigue. No-go: el despliegue la borró. Entonces ninguna exclusión creada a mano sobrevive a un despliegue: tras cada despliegue hay que revisar y recrear las exclusiones del inventario, o no desplegar con exclusiones activas, y el dueño lo decide por escrito antes de seguir. Revertir: borra la ruta de prueba.

### 1.4 Cambios de correo en la zona viva (P0.3 y P0.4)

Ventana común: fuera del horario de pagos y cuando no se esperan correos de Deuna, con el revisor presente.

**P0.3 Alcance del catch-all de Email Routing.** MANUAL.
- Hacer: activa el subdominio `in.<dominio-raiz>` en Email Routing con catch-all hacia el Worker de Cloud (MX y SPF del subdominio). Envía un correo a una dirección desconocida de `in.<dominio-raiz>` y otro a una desconocida del apex.
- Verificar: la dirección explícita del piloto sigue entregando como antes (envía una prueba).
- Go: el catch-all aplica solo a `in.`.
- No-go: es de toda la zona. Las direcciones desconocidas del apex rebotan desde Cloud (la explícita del piloto sigue ganando). Decide por escrito si se acepta.
- Revertir: desactiva la regla y el subdominio.

**P0.4 SPF en un solo registro TXT y DKIM.** MANUAL.
- Hacer: guarda el TXT actual del inventario. Incorpora el dominio remitente de `send_email` y fusiona el SPF existente con el nuevo en **un** registro. Agrega los registros DKIM.
- Verificar: `dig +short TXT <dominio-raiz>`. Go: exactamente un registro que empieza por `v=spf1`, con los mecanismos viejos y nuevos, y un correo de prueba llega con SPF, DKIM y DMARC en pass. No-go: dos registros SPF (permerror).
- Revertir: restaura el TXT del inventario y quita los registros DKIM.

### 1.5 Lista de la sandbox

Responsable: dueño. Pasa la [lista de la sandbox](CLOUD-SANDBOX-CHECKLIST.md) (secciones 1 a 5) contra la zona de producción usando el **tenant del ensayo** de la sección 1.6, antes de deshacerlo. Del "Revertir" de esa lista solo aplica lo que dice la propia lista para cada punto; **nunca** su bloque final de borrado (Nunca, punto 7).

### 1.6 Ensayo con datos inventados

Nunca con un export real. Este ensayo termina con **limpieza total** antes de la fase 1.

1. Responsable: dueño. `pnpm pilot:demo-workdir` (local, sin red, sin frase) crea un `<workdir>` nuevo con dos exports idénticos de datos inventados, en el formato exacto del export real. Imprime la ruta y los conteos.
2. Crea `<workdir>/tenant.json` como en la sección 2, paso 2, con un slug de ensayo (por ejemplo `ensayo-<aleatorio>`) y un QR cualquiera.
3. `pnpm prod:provision <workdir>` (frase `PROVISION <slug-de-ensayo>`), `pnpm pilot:import:plan <workdir>`, `pnpm prod:import <workdir> <tenant-id> <slug-de-ensayo>` (frase `IMPORT <slug-de-ensayo>`) y `pnpm prod:validate <workdir> <tenant-id> <slug-de-ensayo>` (frase `VALIDATE <slug-de-ensayo>`, debe dar MATCH).
4. Usa ese tenant para la lista de la sandbox (sección 1.5).
5. Limpieza total:
   1. `pnpm prod:undo-tenant <workdir> <tenant-id> <slug-de-ensayo>` (frase `UNDO TENANT <slug-de-ensayo>`).
   2. Panel de R2: borra la clave exacta `t/<tenant-id>/assets/deuna-qr.<ext>` (el undo no la borra).
   3. Consola de D1: `SELECT id, slug FROM tenants WHERE source = 'pilot_import';` no debe listar el slug de ensayo, y los conteos de datos de ese tenant deben ser cero.
   4. `pnpm pilot:cleanup <workdir>`.
   5. Si usaste un correo propio para el enlace mágico, revisa que su sesión ya no exista (el undo la borra) y limpia la bandeja.

### Compuertas de la fase 0

- Go: inventario hecho; P0.1 a P0.6 con resultado anotado y sin No-go abierto; `prod:guard` OK; Cloud desplegado en el comodín; correo y SPF verificados; lista de la sandbox aprobada; ensayo con limpieza total comprobada.
- No-go: cualquiera de lo anterior sin cumplir. Rollback de la fase: borra la ruta comodín, el registro `*`, el Worker, el subdominio `in.` y los registros DKIM, y restaura el SPF del inventario. El piloto no cambió.

## 2. Fase 1: migrar los datos (ejecución en paralelo)

El piloto sigue sirviendo el apex. Cloud sirve `<slug-del-curso>.<dominio-raiz>`. Durante esta fase el piloto no debe recibir cambios (sección 0.2). Referencia de comandos en la sección 4. El orden es obligatorio: el plan solo se construye con provisión terminada y con dos exports iguales.

1. Responsable: dueño. T-1 h: `pnpm pilot:export` (frase `EXPORT PILOT READ-ONLY`) con el token de solo lectura. Antes: `unset CLOUDFLARE_API_TOKEN` y carga solo el token de lectura. Sin argumento crea un `<workdir>` nuevo (un `rekauda-pilot-*` en el directorio temporal del sistema, modo 0700). Imprime la ruta, solo conteos y un hash. **Anota la ruta y los conteos** (los necesitas si el workdir se pierde).
2. Responsable: dueño. Crea `<workdir>/tenant.json` (modo 0600) y deja el QR en una ruta real. Forma, con valores inventados:

   ```json
   {
     "slug": "curso-demo",
     "ownerEmail": "tesorero@colegio-demo.example.test",
     "qrPath": "/private/var/folders/xx/T/rekauda-qr/deuna-qr.png",
     "config": {
       "schoolName": "Colegio Demo", "className": "1.º de Básica A", "classShortName": "1.º Básica A", "classMark": "1A",
       "treasury": { "bank": "Banco Demo", "accountType": "Cuenta de ahorros", "accountNumber": "0000000000", "holder": "Tesorero Demo", "holderId": "0000000000", "deunaUrl": null, "qrUrl": null, "helpUrl": null },
       "banks": ["Banco Demo", "Otro banco o cooperativa"], "earliestTransferDate": "2026-11-01", "defaultTone": "#C81E3A", "analytics": { "gaMeasurementId": null }
     }
   }
   ```

   Reglas: solo esas cuatro claves, `slug` válido y no reservado, `ownerEmail` ASCII imprimible sin `;`, `config` con la forma de `rekauda.config.example.ts`, `qrPath` **absoluta y canónica** (sin enlaces simbólicos en el camino; en macOS es la ruta real `/private/var/...`, no `/var/...`) a un PNG, JPG o WebP de 1 byte a 1 MB. Verifica: `chmod 600 <workdir>/tenant.json` y que `realpath <qrPath>` sea igual a `qrPath`.
3. Responsable: dueño. Cambia al token de producción y lee la línea `worker=... account=... root=...`. `pnpm prod:provision <workdir>` valida `tenant.json` y el QR antes de pedir la frase y pide `PROVISION <slug-del-curso>`. Si el correo del propietario ya es una cuenta de una persona, pide `PROVISION <slug-del-curso> REUSE OWNER` (esa cuenta pasa a ser propietaria del tenant nuevo). Si es una cuenta de sistema, se niega. Verifica: imprime `provisioned` y la ruta de `<workdir>/handover.txt` (modo 0600, con la dirección de entrada `d-<token>@in.<dominio-raiz>`; el token nunca se imprime). Anota el `tenant=<id>` impreso: también está en `<workdir>/manifest.json`. Verifica el QR (sección 5, punto 8).
4. Responsable: dueño. T-0, con el token de lectura: `pnpm pilot:export <workdir>` (frase `EXPORT PILOT READ-ONLY`). Verifica: `vs first export: MATCH` (salida 0). Un **MISMATCH** sale con código 3 y es **pegajoso**: aunque un export posterior vuelva a coincidir, ese workdir queda bloqueado para siempre. Recuperación:
   1. `pnpm pilot:export` **sin argumento** (frase `EXPORT PILOT READ-ONLY`) crea un workdir nuevo. Repetir el export en el mismo no sirve.
   2. Deshaz el tenant del workdir viejo: `pnpm prod:undo-tenant <workdir-viejo> <tenant-id> <slug-del-curso>` (frase `UNDO TENANT <slug-del-curso>`). Si no se importó nada, se permite sin plan porque el tenant tiene cero filas de datos.
   3. `pnpm pilot:cleanup <workdir-viejo>`.
   4. Vuelve al paso 2 con el workdir nuevo (otro tenant id) y repite hasta tener dos exports iguales. Espera a que termine la actividad del piloto (sección 0.2).
5. Responsable: dueño. `pnpm pilot:import:plan <workdir>` (local, sin red, sin frase). Verifica: imprime conteos y el número de sentencias; si el preflight falla, imprime solo conteos por revisión (huérfanos, enlaces colgantes, centavos negativos, fechas, slugs). Corrige en el piloto solo con decisión del dueño y vuelve al paso 1.
6. Responsable: dueño. Con el token de producción: `pnpm prod:import <workdir> <tenant-id> <slug-del-curso>` (frase `IMPORT <slug-del-curso>`). Antes revisa que el destino tenga cero filas y que ningún id del piloto exista en Cloud. Verifica: `import.sql executed`. Si falla a medias: `prod:undo-data` (sección 5, punto 1) y reintenta; nunca reimportes encima.
7. Responsable: dueño. **Una sola vez**, justo después del import y **antes** de subir portadas: `pnpm prod:validate <workdir> <tenant-id> <slug-del-curso>` (frase `VALIDATE <slug-del-curso>`). Esperado: `MATCH` (salida 0). Un MISMATCH sale con código 4 y lista las categorías que difieren; nunca se corrige solo: `prod:undo-data` y rehaz desde el paso 5. **Guarda esa salida como la evidencia de la migración.** Los validate posteriores darán MISMATCH de forma esperada (`cover_key` y `updated_at` cambian al subir portadas o editar) y no son una señal de falla. Validar después de un undo no tiene sentido.
8. Responsable: dueño, con tesorería. Revisa en `https://<slug-del-curso>.<dominio-raiz>/`: la recaudación y los pagos, el ingreso al admin con enlace mágico del propietario, el QR, y que los comprobantes antiguos respondan 404 limpio (no se migran). Sube de nuevo las portadas (quedan en `NULL`). El propietario firma que los datos están completos.
9. Responsable: dueño. Justo antes del cambio (sección 3.1), con el token de lectura: `pnpm pilot:export <workdir>` (frase `EXPORT PILOT READ-ONLY`), un **export final** en el mismo workdir. **MATCH**: el piloto no recibió escrituras y no se perdió nada. **MISMATCH** (código 3): es No-go y la migración se rehace (deshaz con la sección 5 y empieza con un workdir nuevo; los pagos o correos nuevos del piloto se concilian a mano). Efecto esperado: este export deja el plan desactualizado para `prod:validate` y `prod:import`, que se negarán (por eso el validate del paso 7 es único y no hay doble import). `prod:undo-data` y `prod:undo-tenant` siguen funcionando porque usan el export del plan.

### Compuertas de la fase 1

- Go: dos exports con MATCH; import y validate (paso 7) en MATCH con la evidencia guardada; export final en MATCH; el propietario verificó todos los datos en el host nuevo y firmó; el piloto sigue sirviendo el apex y su Email Routing.
- No-go: cualquier MISMATCH, preflight o validación fallida, escritura en el piloto o duda del propietario.
- Revertir la fase: `prod:undo-data` (conserva el tenant) o `prod:undo-tenant` (lo quita todo), con las condiciones de la sección 5. Solo valen mientras el import **no está en vivo**. El piloto no cambió.

## 3. Fase 2: cambio del apex

MANUAL con revisor y frase escrita. Hazla solo con la fase 1 en Go y en la ventana acordada.

### 3.1 Antes del cambio (el apex todavía no está en la configuración)

1. Responsable: dueño. Agrega `LEGACY_REDIRECTS` (sección 0.1, punto 4) a `wrangler.production.jsonc`, con **solo la ruta comodín** en `routes`. `pnpm prod:guard` debe pasar.
2. Responsable: dueño. `pnpm prod:deploy` (frase `DEPLOY PRODUCTION`). Todavía no hay entrada del apex, así que la frase es esa y no `SWITCH APEX`.
3. Responsable: dueño. Prueba el 302 por `www`, que el comodín cubre y el Worker trata como apex, siempre que el inventario muestre `www` libre: `curl -sI https://www.<dominio-raiz>/<ruta-heredada>?x=1`. Esperado: 302 con `Cache-Control: no-store` a `https://<slug-del-curso>.<dominio-raiz>/<ruta-heredada>?x=1`. Si `www` ya existe, No-go: elige otra prueba con el revisor.
4. Responsable: dueño. Con el piloto aún en Go (export final con MATCH, paso 9 de la fase 1), agrega la entrada del apex a `routes`: `{ "pattern": "<dominio-raiz>/*", "zone_name": "<dominio-raiz>" }` (o, solo si P0.1 dio No-go, `{ "pattern": "<dominio-raiz>", "custom_domain": true }`). `pnpm prod:guard` debe pasar con el apex.

### 3.2 Cambio

1. Responsable: dueño. `pnpm prod:switch-apex` (frase `SWITCH APEX`), leyendo antes la línea `worker=... account=... root=...`. Es el script que despliega con la ruta del apex.
2. Verificar con `curl -sI`: `https://<dominio-raiz>/<ruta-heredada>?x=1` responde 302, `no-store` y conserva la consulta; `https://<dominio-raiz>/` responde la página de bienvenida de Cloud; `https://<dominio-raiz>/admin` y cualquier otra ruta del apex responden 404; `<ruta-heredada>//` responde 404 (solo se tolera una barra final).
3. Revisa un enlace antiguo real de una familia y el ingreso al admin en el host nuevo.

### 3.3 Reversa

- **Corte**: la reversa solo es limpia mientras **ninguna familia haya pagado en Cloud**. Después del primer pago real en Cloud, volver al piloto deja esos datos huérfanos: no deshagas ni reimportes, concilia según la sección 5.
- **Primaria**: en el panel, borra la ruta del apex de Cloud. El dominio personalizado del piloto vuelve a responder en segundos. Después quita la entrada del apex de `wrangler.production.jsonc`.
- **Verificar la reversa**: `curl -sI https://<dominio-raiz>/<ruta-heredada>` ya no responde el 302 de Cloud sino la página del piloto, y el panel o los registros del Worker del piloto muestran tráfico de nuevo. La página de bienvenida de `/` puede seguir en caché unos 5 minutos (`max-age=300`); el 302 no se cachea.
- **Alternativa**: ver la sección 3.4.
- Cuidado con la lista de rutas: `wrangler deploy` reemplaza la lista de rutas del Worker. **Quitar la entrada del apex de la configuración y desplegar desvincula el apex** y lo deja fuera de línea. Por eso, mientras el apex deba seguir en Cloud, todo despliegue lleva la entrada y pide `SWITCH APEX`, también con `pnpm prod:deploy` (su frase `DEPLOY PRODUCTION` pasa a ser `SWITCH APEX` cuando la configuración trae la entrada). Para revertir, borra primero la ruta en el panel y solo después cambia el archivo.
- Una reversa solo cambia el enrutamiento HTTP. Antes del primer pago en Cloud el piloto sigue siendo la fuente de verdad; después, Cloud lo es.

### 3.4 Alternativa: mover el dominio personalizado

Si P0.1 dio No-go o la vía primaria no basta: en el panel, vuelve a asociar el dominio personalizado del apex al Worker congelado del piloto. Wrangler no tiene un comando para soltar o reasignar el dominio de otro Worker. Después verifica como en 3.3.

### Compuertas de la fase 2

- Go: prueba por `www` OK; 302 `no-store` con consulta; bienvenida en `/`; 404 en `/admin`; el enlace antiguo llega al host nuevo; el propietario entra al admin; el piloto no recibe tráfico nuevo del apex.
- No-go: cualquier respuesta distinta. Reversa 3.3 de inmediato (si aún no hubo pagos en Cloud) y diagnostica con calma.

## 4. Referencia de comandos

Todos corren desde la raíz del repositorio. Los `prod:*` aplican la guarda de producción antes de cada proceso y de nuevo justo antes de lanzarlo, rechazan un config distinto del primero que se revisó, usan un entorno reducido y piden la frase en una terminal. Los que no llevan datos no aceptan argumentos ni `--remote`, `--config`, `--env`, `--local`. Las frases son exactas.

| Comando | Argumentos | Frase | Se niega si |
|---|---|---|---|
| `pnpm prod:guard` | ninguno | ninguna | el config no cumple las reglas de 0.1; Node sin type stripping |
| `pnpm prod:status` | ninguno | ninguna | la guarda falla (solo lectura) |
| `pnpm prod:migrate` | ninguno | `MIGRATE PRODUCTION` | la guarda falla, sin terminal |
| `pnpm prod:deploy` | ninguno | `DEPLOY PRODUCTION`; **`SWITCH APEX` si la configuración trae la entrada del apex** | falla alguna regla de la guarda, sin terminal |
| `pnpm prod:switch-apex` | ninguno | `SWITCH APEX` | **no** hay entrada del apex, o la guarda falla |
| `pnpm pilot:demo-workdir` | ninguno | ninguna | recibe argumentos (local, sin red, datos inventados) |
| `pnpm pilot:export` | `[<workdir>]` | `EXPORT PILOT READ-ONLY` | hay argumentos extra o flags, la referencia del piloto está incompleta (falta `productionRoot`, nombre, id o cuenta), el argumento no es un workdir propio, sin terminal. Sale con 3 en MISMATCH |
| `pnpm pilot:cleanup` | `<workdir>` | ninguna | el directorio no tiene la marca de la herramienta (no borra nada) |
| `pnpm pilot:import:plan` | `<workdir>` | ninguna | Node < 22.18; no hay provisión terminada; faltan dos exports iguales o hubo un MISMATCH; el preflight falla |
| `pnpm prod:provision` | `<workdir>` | `PROVISION <slug>`; con cuenta existente, `PROVISION <slug> REUSE OWNER` | `tenant.json` o QR inválidos; hay `provision.lock`; hay un intento sin terminar; el correo es de una cuenta de sistema |
| `pnpm prod:import` | `<workdir> <tenant-id> <slug>` | `IMPORT <slug>` | el plan falta o está desactualizado; el tenant no es `pilot_import` con ese slug y cero filas; algún id del piloto ya existe |
| `pnpm prod:validate` | `<workdir> <tenant-id> <slug>` | `VALIDATE <slug>` | el plan está desactualizado (por ejemplo tras un export final) o no se pueden leer las filas. Sale con 4 en MISMATCH |
| `pnpm prod:undo-data` | `<workdir> <tenant-id> <slug>` | `UNDO DATA <slug>` | falta el plan, hay filas fuera del plan, o el tenant no es `pilot_import` |
| `pnpm prod:undo-tenant` | `<workdir> <tenant-id> <slug>` | `UNDO TENANT <slug>` | igual; sin plan solo vale con cero filas de datos |

Notas: el `<tenant-id>` es un UUID en minúsculas y el slug debe cumplir las reglas de tenant. `prod:undo-tenant` borra además sesiones, enlaces mágicos, membresías, dominio y el tenant, y los usuarios cuya única membresía era ese tenant (propietario y cotesoreros). No borra el objeto del QR. La salida de estos comandos son solo conteos y resultados, nunca filas ni datos personales.

## 5. Recuperación

Todo deshacer solo vale con el import **sin estar en vivo**: necesita el plan del `<workdir>`, o el tenant con cero filas de datos. Cuando ya hay pagos o recaudaciones nuevos creados en Cloud, **no** deshagas: concilia a mano (la importación de `.eml` del admin cubre los correos de Deuna que lleguen al sistema equivocado) y decide con el dueño.

1. **Import a medias o rechazado.** `pnpm prod:undo-data <workdir> <tenant-id> <slug>` (frase `UNDO DATA <slug>`) deja cero filas y conserva el tenant. Verifica con el conteo que imprime. Reintenta desde el plan.
2. **Provisión a medias.** El estado queda como `provisioning` en `manifest.json` y un reintento se niega y apunta a `pnpm prod:undo-tenant <workdir> <tenant-id> <slug>` (frase `UNDO TENANT <slug>`), que sin plan solo funciona con cero filas de datos y limpia el manifiesto. Si la fila del tenant nunca se escribió, solo limpia el manifiesto.
3. **Falta el `<workdir>`** (se borró, se perdió o un reinicio vació el directorio temporal): `prod:undo-data` y `prod:undo-tenant` se niegan. Se quita a mano en la consola de D1 de producción. Antes de empezar:
   1. **El tenant no está en vivo.** Compara los conteos de Cloud con los del export que anotaste (sección 2, paso 1). Si algún conteo es **mayor**, hay datos nuevos: detente, no borres.

      ```sql
      SELECT (SELECT COUNT(*) FROM collections WHERE tenant_id = '<tenant-id>') AS collections, (SELECT COUNT(*) FROM payments WHERE tenant_id = '<tenant-id>') AS payments, (SELECT COUNT(*) FROM students WHERE tenant_id = '<tenant-id>') AS students, (SELECT COUNT(*) FROM bank_movements WHERE tenant_id = '<tenant-id>') AS bank_movements;
      SELECT id, slug, source FROM tenants WHERE id = '<tenant-id>';
      ```

      El tenant debe tener `source = 'pilot_import'` y el slug esperado.
   2. En el panel de D1, anota el bookmark de **Time Travel** actual: permite restaurar si algo se borra por error.
   3. Lee los usuarios **antes** de borrar las membresías, uno por cada miembro (propietario y cotesoreros), y anota los ids:

      ```sql
      SELECT user_id FROM memberships WHERE tenant_id = '<tenant-id>';
      ```

   4. Ejecuta una a una, en este orden exacto, las sentencias de abajo (cambia `<tenant-id>` y repite la línea de `users` con cada `<user-id>` anotado). Para quitar solo los datos y conservar el tenant, ejecuta únicamente las cuatro primeras.

      ```sql
      DELETE FROM bank_movements WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM students WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM payments WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM collections WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM sessions WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM magic_links WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM memberships WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM users WHERE id = '<user-id>' AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '<user-id>') AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM tenant_domains WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import');
      DELETE FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import';
      ```

      La cláusula `NOT EXISTS` evita borrar a un usuario que además es miembro de otro tenant.
   5. Verifica: repite el primer `SELECT` (todo en cero) y `SELECT id FROM tenants WHERE id = '<tenant-id>';` (sin filas, si quitaste el tenant). Nunca ejecutes un `DELETE` sin su filtro de tenant.
4. **Borrar el objeto del QR.** Ningún comando lo borra. En el panel de R2, bucket de recibos de Cloud, borra la clave exacta `t/<tenant-id>/assets/deuna-qr.<ext>`. Cuidado con el panel: borra el objeto y no una carpeta, y nunca otro prefijo `t/<otro-id>/`.
5. **Objeto huérfano tras una provisión fallida.** Un intento fallido puede dejar `t/<tenant-id>/assets/deuna-qr.<ext>` sin tenant. Bórralo como en el punto 4 o déjalo: el siguiente intento usa otro id.
6. **`handover.txt` viejo.** Tras un undo, borra `<workdir>/handover.txt` (se sobrescribe en el siguiente éxito, pero no lo dejes con la dirección de un tenant ya borrado).
7. **`provision.lock` viejo.** Si un cierre brusco lo dejó, revisa que no haya otro `prod:provision` corriendo y bórralo a mano de `<workdir>`.
8. **Verificar el QR.** Tras provisionar, `https://<slug-del-curso>.<dominio-raiz>/api/assets/deuna-qr.<ext>` debe responder 200 con la imagen, o confirma el objeto en el panel de R2 bajo `t/<tenant-id>/assets/`. Un 404 significa que la subida no llegó: deshaz con `prod:undo-tenant` (punto 2) y provisiona de nuevo.

## 6. Después del cambio

1. Responsable: dueño. Con el apex verificado (compuertas de la fase 2 en Go) y la dirección de entrada `d-<token>@in.<dominio-raiz>` guardada en el gestor de secretos del equipo (se lee de `handover.txt` una sola vez, en una terminal privada), ejecuta `pnpm pilot:cleanup <workdir>`: borra exports, SQL y `handover.txt`. La reversa del apex no necesita el workdir. Hazlo a más tardar al cambiar el correo de Deuna (punto 2).
2. Responsable: dueño. **+24 a 48 h** con Cloud estable: cambia el correo de Deuna a `d-<token>@in.<dominio-raiz>`. La dirección antigua sigue en el piloto durante los 14 días. Revertir: devuelve la dirección anterior en Deuna. Los correos que hayan llegado a Cloud en ese lapso se conservan en su archivo de correo: concilia con la importación de `.eml` del admin del sistema que quede activo.
3. Responsable: dueño. **+14 días** sin incidentes: retira el Worker del piloto (bórralo o déjalo, pero **no** crees un Worker que solo redirija). **Conserva la D1 y el bucket R2 del piloto**: los comprobantes no se migran y son la prueba de los pagos. Propuesta: guardarlos al menos 90 días después del cierre de la última recaudación migrada y borrarlos solo con la aprobación escrita de tesorería y del dueño.
4. Responsable: dueño. Quita la regla antigua de Email Routing del piloto **solo después de confirmar** que Deuna entrega a la dirección nueva (llega al menos un correo real de movimiento a Cloud). Revertir: vuelve a crear la regla.
5. Responsable: dueño. Revoca los tokens de API de la migración (sección 0.1, punto 6).
6. Responsable: dueño. **Primero** etiqueta `pilot-final` en el último commit del piloto en `main` (`git tag pilot-final <commit>` y súbela). **Después** mezcla `feat/cloud` a `main`. Con ese merge se retiran los scripts antiguos del piloto: `scripts/pending.sh` y `scripts/review.sh`.

## 7. Comportamientos conocidos

- `<ruta-heredada>//` (dos barras) responde 404. Una barra final se acepta y redirige igual.
- El núcleo de la guarda importa `src/worker/apex/legacy-redirects.ts`. Cualquier copia parcial del repositorio (por ejemplo en un directorio temporal) debe incluir ese archivo, o la guarda no carga.
- Salvo `pnpm prod:guard`, los scripts `prod:*` y `pilot:*` muestran un error crudo de Node con un Node viejo (ver 0.1).
- Los comprobantes no se migran. Las portadas tampoco: se vuelven a subir desde el admin.
- Un export final con MATCH no cambia nada en Cloud, pero deja el plan desactualizado: `prod:validate` y `prod:import` se niegan hasta rehacer el plan (`pnpm pilot:import:plan`), y `prod:undo-*` siguen funcionando.
