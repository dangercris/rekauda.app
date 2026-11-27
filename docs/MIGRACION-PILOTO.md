# Migración del piloto a Rekauda Cloud

Runbook para pasar un curso del piloto (un Worker, una D1 y un bucket R2 propios) a un tenant de Rekauda Cloud, y mover el dominio raíz al final. Es un documento único y se ejecuta en orden. Todo lo que cambia DNS, rutas, dominios personalizados o Email Routing es **MANUAL** (panel de Cloudflare) y lo revisa una segunda persona. Ningún script toca esos recursos.

Convenciones: `<dominio-raiz>` es el dominio de producción, `<slug-del-curso>` el slug del tenant, `<ruta-heredada>` la ruta antigua del piloto (`/r/<slug-heredado>`), `<workdir>` el directorio privado que crea `pilot:export`. Los ejemplos usan `colegio-demo` y dominios `example.test`, nunca datos reales. Este documento no contiene secretos, ids ni nombres reales y no debe recibirlos.

Cada paso indica **Responsable**, **Hacer**, **Verificar** y **Revertir**. Cada fase termina con compuertas **Go** y **No-go**: un solo No-go detiene la migración.

## 0. Antes de empezar

### 0.1 Requisitos

1. Responsable: dueño. Node >= 22.18 (`node -v`). Con un Node anterior, `pnpm prod:guard` se niega con un mensaje claro. Los demás envoltorios `prod:*` y `pilot:*` muestran un error crudo de Node (módulo o `node:sqlite` no encontrado): es la misma causa, cambia de Node.
2. Responsable: dueño. Copia a mano `wrangler.production.example.jsonc` a `wrangler.production.jsonc` (ignorado por git, nunca se copia solo) y completa tus valores. Reglas que la guarda aplica en cada comando: nombres de Worker, D1 y buckets con prefijo `rekauda-cloud-`, exactamente 3 limitadores, ids reales (los de ceros se rechazan), nada que coincida con el piloto ni con la sandbox, `vars` solo `TENANCY`, `ROOT_DOMAIN`, `INBOUND_DOMAIN` y `LEGACY_REDIRECTS`, y `routes` solo el comodín `*.<dominio-raiz>/*`.
3. `LEGACY_REDIRECTS` es un **objeto JSON** (no una cadena) y va solo en este archivo. Una entrada, valor exacto `https://<slug>.<dominio-raiz>/r/<mismo-slug>`, slug válido de tenant y no reservado (por ejemplo `www` o `api` se rechazan). Se agrega en la fase 2, no antes:

   ```jsonc
   "LEGACY_REDIRECTS": { "/r/curso-demo": "https://curso-demo.colegio-demo.example.test/r/curso-demo" }
   ```

4. Responsable: dueño. Crea `.pilot-resources.json` en la raíz del repositorio (ignorado por git, nunca se sube). Debe traer las ocho claves, con `productionRoot` obligatorio y igual a `ROOT_DOMAIN` de producción. Sin `productionRoot` la guarda se niega. Forma, con valores inventados:

   ```json
   { "workers": ["worker-piloto"], "d1Ids": ["11111111-2222-3333-4444-555555555555"], "buckets": ["bucket-piloto"], "ratelimitIds": ["1001"], "names": [], "ids": [], "domains": [], "productionRoot": "colegio-demo.example.test" }
   ```

   El nombre, el id y la cuenta de la D1 del piloto salen del `wrangler.jsonc` local del piloto (una sola D1). Nunca se imprimen.
5. Responsable: dueño. Dos tokens de API distintos, siempre por variable de entorno y nunca escritos en un archivo ni pegados en el chat. Para `pilot:export`: solo lectura de D1 de la cuenta del piloto (la herramienta no puede verificar los permisos del token, tú sí). Para `prod:*`: el de producción, con permisos de despliegue, D1 y R2.
6. Todos los comandos de `pnpm prod:*` piden una **frase escrita en una terminal** (TTY). Sin terminal se niegan. No existe `-y`.

### 0.2 Cuándo migrar

No migres con una recaudación abierta y con fecha límite cercana. Elige una ventana en que no entren pagos nuevos y en que el piloto pueda quedar congelado (sin cursos ni revisiones) durante las fases 1 y 2. Si un pago entra durante la ventana, el export de T-0 lo detecta (MISMATCH) y se repite.

## 1. Fase 0: preparar Cloud sin tocar el piloto

Responsable: dueño, con revisor para todo paso manual. El piloto sigue sirviendo el dominio raíz y su Email Routing sin cambios.

### 1.1 Sondas del dueño (P0.*)

Cada sonda se ejecuta a mano, nunca un agente, **solo con recursos de la sandbox o con hosts de prueba que empiezan por `cd-probe-` bajo la zona**, y se borra al terminar. Anota el resultado al lado de cada una (fecha, resultado, decisión). Si una sonda da No-go, no sigas a la fase 1 hasta que el dueño y el revisor decidan por escrito.

**P0.1 La ruta gana al dominio personalizado.**
- Hacer: crea el host `cd-probe-<aleatorio>.<dominio-raiz>` como dominio personalizado del Worker de la sandbox A. Agrega una ruta `cd-probe-<aleatorio>.<dominio-raiz>/*` hacia el Worker de la sandbox B. Pide el host con `curl -sI`.
- Verificar: Workers Logs muestran qué Worker respondió. Comprueba también que wrangler o el panel aceptan la ruta mientras existe el dominio personalizado.
- Go: responde el Worker de la ruta y la ruta se acepta. Entonces la ruta `<dominio-raiz>/*` toma el apex sin tocar al piloto.
- No-go: responde el dominio personalizado o la ruta se rechaza. La vía principal de la fase 2 no sirve: usa la alternativa de mover el dominio personalizado (sección 3.3) y ajusta la fase 2 antes de seguir.
- Revertir: borra la ruta y el dominio de prueba.

**P0.2 Comportamiento de `wrangler d1 execute` y de R2 sin terminal.** Prueba en la D1 y el bucket de la sandbox, con un config generado en un directorio temporal (`account_id` y una sola entrada `d1_databases`, sin otro config en el árbol) y con la entrada cerrada (`< /dev/null`), como la lanzan los envoltorios.
- (a) Forma del resultado: `wrangler d1 execute <nombre-d1> --remote --json --config <generado> --command "SELECT 1 AS a; SELECT 2 AS b;"`. Go: un arreglo JSON con una entrada por sentencia, en orden, cada una con `success: true` y `results`. No-go: una sola entrada o un error. `pilot:export` depende de esa forma: se detiene el proyecto y se cambia a cuatro SELECT separados (cambio de código).
- (b) Resolución: Go si el comando resuelve la D1 por nombre con `--config <generado>` y la cuenta del config, sin preguntar. No-go si pide elegir cuenta o base.
- (c) `--file`: crea una tabla de prueba y un archivo con un INSERT válido seguido de otro que falla (tabla inexistente). Ejecuta `d1 execute <nombre-d1> --remote --config <generado> --file <archivo>`. Registra si queda la primera fila (no atómico) o no (atómico). Cualquiera de los dos es Go, porque la seguridad no depende de ello: el import solo arranca con cero filas y `prod:undo-data` limpia. Si pide confirmación y se queda esperando, es No-go: no agregues `-y` sin revisión.
- (d) `wrangler r2 object put <bucket-sandbox>/t/prueba/assets/x.png --file <png> --content-type image/png --remote --config <generado>` con la entrada cerrada. Go: sube sin preguntar y toma la cuenta del config. Verifica con `wrangler r2 object get ... --remote --config <generado> --file <destino>`. No-go: pide confirmación o usa otra cuenta.
- Revertir: borra la tabla y el objeto de prueba.

**P0.3 Alcance del catch-all de Email Routing.**
- Hacer: activa el subdominio `in.<dominio-raiz>` en Email Routing con catch-all hacia el Worker de Cloud. Envía un correo a una dirección desconocida de `in.<dominio-raiz>` y otro a una desconocida del apex.
- Go: el catch-all aplica solo a `in.`. El apex sigue como en el inventario.
- No-go: el catch-all es de toda la zona. Las direcciones desconocidas del apex ahora rebotan desde Cloud (la dirección explícita del piloto sigue ganando). Decide por escrito si se acepta antes de seguir.
- Revertir: desactiva la regla y el subdominio.

**P0.4 SPF en un solo registro TXT.**
- Hacer: guarda el TXT actual del inventario. Incorpora el dominio remitente de `send_email` y fusiona el SPF existente con el nuevo en **un** registro.
- Verificar: `dig +short TXT <dominio-raiz>`. Go: exactamente un registro que empieza por `v=spf1`, con los mecanismos viejos y nuevos, y llegan los correos con SPF, DKIM y DMARC en pass. No-go: dos registros SPF (permerror).
- Revertir: restaura el TXT del inventario y quita los registros DKIM.

**P0.5 El comodín no captura subdominios existentes.**
- Hacer: antes de crear el comodín, exporta el inventario DNS de la zona (registros, rutas, dominios personalizados, reglas de Email Routing, reglas de redirección y de página, SPF actual).
- Go: ningún subdominio con proxy existente queda bajo `*.<dominio-raiz>/*`, o cada uno tiene una ruta de exclusión "sin Worker" creada a mano. Con la precedencia de P0.1 esto incluye hosts con dominio personalizado.
- No-go: hay un host con proxy sin cubrir. No crees el comodín.

**P0.6 `wrangler deploy` reemplaza la lista de rutas.**
- Hacer: agrega una ruta manual en el panel a un Worker de la sandbox y despliega con `pnpm sandbox:deploy`. Después, con un host de prueba, despliega con una entrada `custom_domain` de otro Worker y la entrada cerrada.
- Verificar: si la ruta manual desapareció, el despliegue reemplaza la lista. Anota también si el reemplazo del dominio ajeno pregunta, falla o lo pisa sin preguntar.
- Go: resultado anotado. Si reemplaza la lista, toda ruta debe vivir en `wrangler.production.jsonc` y ninguna se crea a mano para Cloud. Si pisa dominios ajenos sin preguntar, nunca despliegues con un `custom_domain` que no sea el tuyo.

### 1.2 Despliegue y correo

1. Responsable: dueño, MANUAL con revisor. Registro DNS `*` AAAA `100::` con proxy. Revertir: borra el registro (los explícitos como `in` no se pisan).
2. Responsable: dueño. `pnpm prod:guard` debe terminar en OK. Luego `pnpm prod:migrate` (frase `MIGRATE PRODUCTION`) y `pnpm prod:deploy` (frase `DEPLOY PRODUCTION`). Verifica con `pnpm prod:status`. Revertir: borra la ruta o el Worker en el panel.
3. Responsable: dueño, MANUAL con revisor. Email Routing del subdominio `in.<dominio-raiz>` (MX y SPF) con catch-all hacia el Worker (según P0.3) y la incorporación del remitente `send_email` con DKIM y SPF fusionado (P0.4). Revertir: ver P0.3 y P0.4.
4. Responsable: dueño. Pasa la [lista de la sandbox](CLOUD-SANDBOX-CHECKLIST.md) (secciones 1 a 5) contra la zona de producción con un tenant de demostración, y luego **borra el ensayo**: el tenant de demostración y sus datos con `pnpm prod:undo-tenant` si se creó con `prod:provision`, o a mano según la sección 5, punto 3.
5. Responsable: dueño. Ensayo completo con un tenant desechable de datos inventados: `prod:provision`, `pilot:import:plan`, `prod:import`, `prod:validate` y `prod:undo-tenant` (sección 2, pasos 3 a 7, y sección 5, punto 1). Para el ensayo necesitas un export inventado en un `<workdir>` propio. Verifica además que el objeto del QR existe tras el provision (sección 5, punto 8).

### Compuertas de la fase 0

- Go: P0.1 a P0.6 con resultado anotado y sin No-go abierto; inventario DNS hecho; `prod:guard` OK; Cloud desplegado en el comodín; lista de la sandbox aprobada; tenant de demostración borrado; ensayo con undo hecho.
- No-go: cualquiera de lo anterior sin cumplir. Rollback de la fase: borra la ruta comodín, el registro `*`, el Worker, `in.` y los registros DKIM. El piloto no cambió nunca.

## 2. Fase 1: migrar los datos (ejecución en paralelo)

El piloto sigue sirviendo el apex. Cloud sirve `<slug-del-curso>.<dominio-raiz>`. Durante esta fase el piloto no debe recibir cambios.

Referencia de comandos en la sección 4. Orden obligatorio (el código lo exige: el plan solo se construye con provisión terminada y con dos exports iguales):

1. Responsable: dueño. T-1 h: `pnpm pilot:export` (frase `EXPORT PILOT READ-ONLY`) con el token de solo lectura. Imprime el `<workdir>` (un `rekauda-pilot-*` en el directorio temporal del sistema, modo 0700), solo conteos y un hash. Guarda la ruta.
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

   Reglas: solo esas cuatro claves, `slug` válido y no reservado, `ownerEmail` ASCII imprimible sin `;`, `config` con la forma de `rekauda.config.example.ts`, `qrPath` **absoluta y canónica** (sin enlaces simbólicos en ninguna parte del camino; en macOS es la ruta real `/private/var/...`, no `/var/...`) a un PNG, JPG o WebP de 1 byte a 1 MB. Verifica: `chmod 600 <workdir>/tenant.json` y `realpath <qrPath>` igual a `qrPath`.
3. Responsable: dueño. `pnpm prod:provision <workdir>`. Valida `tenant.json` y el QR antes de pedir la frase, imprime worker, cuenta, raíz, id y slug, y pide `PROVISION <slug-del-curso>`. Si el correo del propietario ya es una cuenta de una persona, pide `PROVISION <slug-del-curso> REUSE OWNER` (esa cuenta pasa a ser propietaria del tenant nuevo). Si es una cuenta de sistema, se niega. Verifica: imprime `provisioned` y la ruta de `<workdir>/handover.txt` (modo 0600, contiene la dirección de entrada `d-<token>@in.<dominio-raiz>`; el token nunca se imprime). Anota el `tenant=<id>` impreso: también está en `<workdir>/manifest.json`.
4. Responsable: dueño. T-0: de nuevo `pnpm pilot:export <workdir>`. Verifica: `vs first export: MATCH` (código de salida 0). Un **MISMATCH** sale con código 3 y es **pegajoso**: aunque un export posterior vuelva a coincidir, la migración queda bloqueada.
5. Responsable: dueño. `pnpm pilot:import:plan <workdir>` (local, sin red, sin frase). Verifica: imprime conteos y el número de sentencias; si el preflight falla, imprime solo conteos por revisión (huérfanos, enlaces colgantes, centavos negativos, fechas, slugs). Corrige en el piloto solo con decisión del dueño y vuelve al paso 1.
6. Responsable: dueño. `pnpm prod:import <workdir> <tenant-id> <slug-del-curso>` (frase `IMPORT <slug-del-curso>`). Revisa antes que el destino tenga cero filas y que ningún id del piloto exista en Cloud. Verifica: `import.sql executed`. Si falla a medias: `pnpm prod:undo-data` (sección 5, punto 1) y reintenta.
7. Responsable: dueño. `pnpm prod:validate <workdir> <tenant-id> <slug-del-curso>` (frase `VALIDATE <slug-del-curso>`). Verifica: `MATCH`. Un `MISMATCH` lista las categorías que difieren y nunca se corrige solo.
8. Responsable: dueño. Revisa en `https://<slug-del-curso>.<dominio-raiz>/`: la recaudación y los pagos; ingreso al admin con enlace mágico del propietario; el QR en `/api/assets/deuna-qr.png`; sube de nuevo las portadas (no se migran, quedan en `NULL`); los comprobantes antiguos responden 404 limpio (no se migran). Si dudas de cualquier dato, `prod:undo-data` y reimporta.
9. Responsable: dueño. Cuando termines, `pnpm pilot:cleanup <workdir>` borra el `<workdir>` completo (exports con datos personales, SQL, `handover.txt`). **No lo hagas** hasta pasar la fase 2 y la sección 5, porque el undo necesita el plan.

### Compuertas de la fase 1

- Go: dos exports con MATCH (nunca MISMATCH); import y `prod:validate` en MATCH; el propietario verificó todos los datos en el host nuevo y firmó; el piloto sigue sirviendo el apex y su Email Routing.
- No-go: cualquier MISMATCH, preflight o validación fallida, o duda del propietario.
- Revertir la fase: `pnpm prod:undo-data` (conserva el tenant) o `pnpm prod:undo-tenant` (lo quita todo). Solo valen mientras el import **no está en vivo** (sección 5). El piloto no cambió.

## 3. Fase 2: cambio del apex

MANUAL con revisor y frase escrita. Hazla solo con la fase 1 en Go y en una ventana acordada.

### 3.1 Antes del cambio

1. Responsable: dueño. Agrega `LEGACY_REDIRECTS` (sección 0.1) y agrega la entrada del apex a `routes`: `{ "pattern": "<dominio-raiz>/*", "zone_name": "<dominio-raiz>" }` (o, solo si P0.1 dio No-go, `{ "pattern": "<dominio-raiz>", "custom_domain": true }`). `pnpm prod:guard` debe pasar con el apex.
2. Responsable: dueño. Comprueba antes: exports iguales (MATCH), validación en MATCH y la prueba por `https://www.<dominio-raiz>/<ruta-heredada>` (el comodín cubre `www` y el Worker lo trata como apex), siempre que el inventario muestre `www` libre. Esperado: 302 con `Cache-Control: no-store` a `https://<slug-del-curso>.<dominio-raiz>/<ruta-heredada>`.

### 3.2 Cambio

1. Responsable: dueño. `pnpm prod:switch-apex` (frase `SWITCH APEX`).
2. Verificar con `curl -sI`: `https://<dominio-raiz>/<ruta-heredada>?x=1` responde 302, `no-store` y conserva la consulta; `https://<dominio-raiz>/` responde la página de bienvenida de Cloud; `https://<dominio-raiz>/admin` y cualquier otra ruta del apex responden 404; `<ruta-heredada>//` responde 404 (comportamiento conocido, solo se tolera una barra final).
3. Revisa un enlace antiguo real de una familia y el ingreso al admin en el host nuevo.

### 3.3 Reversa

- **Primaria**: en el panel, borra la ruta del apex de Cloud. El dominio personalizado del piloto vuelve a responder en segundos. Después quita la entrada del apex de `wrangler.production.jsonc`.
- **Alternativa** (si la vía principal se descartó en P0.1, o no basta): en el panel, vuelve a asociar el dominio personalizado del apex al Worker congelado del piloto. Wrangler no tiene un comando para soltar o reasignar el dominio de otro Worker.
- Cuidado con la lista de rutas: `wrangler deploy` reemplaza la lista de rutas del Worker. **Quitar la entrada del apex de la configuración y desplegar desvincula el apex** y lo deja fuera de línea. Por eso, mientras el apex deba seguir en Cloud, todo despliegue lleva la entrada y pide `SWITCH APEX`, también con `pnpm prod:deploy`. Para revertir, borra primero la ruta en el panel y solo después cambia el archivo.
- Una reversa solo cambia el enrutamiento HTTP. Tras la fase 2 Cloud es la fuente de verdad de los datos.

### Compuertas de la fase 2

- Go: pruebas previas OK; 302 `no-store` con consulta; landing en `/`; 404 en `/admin`; enlace antiguo llega al host nuevo; el propietario entra al admin; el piloto no recibe tráfico nuevo del apex.
- No-go: cualquier respuesta distinta. Reversa 3.3 de inmediato y diagnostica con calma.

## 4. Referencia de comandos

Todos corren desde la raíz del repositorio. Los `prod:*` aplican la guarda de producción antes de cada proceso y de nuevo justo antes de lanzarlo, rechazan un config distinto del primero que se revisó, usan un entorno reducido y piden la frase en una terminal. Los envoltorios `prod:*` sin datos no aceptan argumentos ni `--remote`, `--config`, `--env`, `--local`.

| Comando | Argumentos | Frase | Se niega si |
|---|---|---|---|
| `pnpm prod:guard` | ninguno | ninguna | el config no cumple las reglas de 0.1; Node sin type stripping |
| `pnpm prod:status` | ninguno | ninguna | la guarda falla (solo lectura) |
| `pnpm prod:migrate` | ninguno | `MIGRATE PRODUCTION` | la guarda falla, sin terminal |
| `pnpm prod:deploy` | ninguno | `DEPLOY PRODUCTION`; **`SWITCH APEX` si la configuración trae la entrada del apex** | falta alguna regla de la guarda, sin terminal |
| `pnpm prod:switch-apex` | ninguno | `SWITCH APEX` | **no** hay entrada del apex, o la guarda falla |
| `pnpm pilot:export` | `[<workdir>]` | `EXPORT PILOT READ-ONLY` | hay argumentos extra o flags, la referencia del piloto está incompleta (falta `productionRoot`, nombre, id o cuenta), el argumento no es un workdir propio, sin terminal |
| `pnpm pilot:cleanup` | `<workdir>` | ninguna | el directorio no tiene la marca de la herramienta (no borra nada) |
| `pnpm pilot:import:plan` | `<workdir>` | ninguna | Node < 22.18; no hay provisión terminada; faltan dos exports iguales o se vio un MISMATCH; el preflight falla |
| `pnpm prod:provision` | `<workdir>` | `PROVISION <slug>`; con cuenta existente, `PROVISION <slug> REUSE OWNER` | `tenant.json` o QR inválidos; hay `provision.lock`; hay un intento sin terminar; el correo es de una cuenta de sistema |
| `pnpm prod:import` | `<workdir> <tenant-id> <slug>` | `IMPORT <slug>` | el plan falta o cambió; el tenant no es `pilot_import` con ese slug y cero filas; algún id del piloto ya existe |
| `pnpm prod:validate` | `<workdir> <tenant-id> <slug>` | `VALIDATE <slug>` | no se pueden leer las filas (solo lectura) |
| `pnpm prod:undo-data` | `<workdir> <tenant-id> <slug>` | `UNDO DATA <slug>` | falta el plan, hay filas fuera del plan, o el tenant no es `pilot_import` |
| `pnpm prod:undo-tenant` | `<workdir> <tenant-id> <slug>` | `UNDO TENANT <slug>` | igual; sin plan solo vale con cero filas de datos |

Notas: el `<tenant-id>` es un UUID en minúsculas y el slug debe cumplir las reglas de tenant. Las frases son exactas. `prod:undo-tenant` borra además sesiones, enlaces mágicos, membresías, dominio y el tenant, y los usuarios cuya única membresía era ese tenant. No borra el objeto del QR. La salida de estos comandos son solo conteos y resultados, nunca filas ni datos personales.

## 5. Recuperación

Todo comando de deshacer solo vale con el import **sin estar en vivo**: necesita el plan del `<workdir>`, o el tenant con cero filas de datos. Cuando los padres ya crearon pagos o recaudaciones nuevas en Cloud, **no** deshagas: concilia a mano (la importación de `.eml` del admin cubre los correos de Deuna que lleguen al piloto) y decide con el dueño.

1. **Import a medias o rechazado.** `pnpm prod:undo-data <workdir> <tenant-id> <slug>` deja cero filas y conserva el tenant. Verifica con `pnpm prod:validate` o con el conteo que imprime. Reintenta desde el plan.
2. **Provisión a medias.** El estado queda como `provisioning` en `manifest.json` y un reintento se niega y apunta a `pnpm prod:undo-tenant`, que sin plan solo funciona con cero filas de datos y limpia el manifiesto. Si la fila del tenant nunca se escribió, el comando solo limpia el manifiesto.
3. **Falta el `<workdir>`** (se borró o se perdió): `undo-data` y `undo-tenant` se niegan. Quita a mano, en la consola de D1 de producción, solo para el `<tenant-id>` del tenant `pilot_import` (revisa antes con `SELECT id, slug, source FROM tenants WHERE id = '<tenant-id>'`). Orden: `bank_movements`, `students`, `payments`, `collections`, y para quitar el tenant `sessions`, `magic_links`, `memberships`, `tenant_domains` y `tenants` al final. Cada `DELETE` lleva `WHERE tenant_id = '<tenant-id>' AND EXISTS (SELECT 1 FROM tenants WHERE id = '<tenant-id>' AND source = 'pilot_import')`. Borra al usuario propietario solo si no tiene otra membresía. Verifica con `SELECT COUNT(*)` por tabla y tenant, que debe dar cero. Nunca ejecutes un `DELETE` sin el filtro del tenant.
4. **Borrar el objeto del QR.** Ningún comando lo borra. En el panel de R2, bucket de recibos de Cloud, borra `t/<tenant-id>/assets/deuna-qr.<ext>`. No toques otros prefijos `t/<otro-id>/`.
5. **Objeto huérfano tras una provisión fallida.** Un intento fallido puede dejar `t/<tenant-id>/assets/deuna-qr.<ext>` sin tenant. Bórralo a mano (punto 4) o déjalo: el siguiente intento usa otro id.
6. **`handover.txt` viejo.** Tras un undo, borra `<workdir>/handover.txt` (se sobrescribe en el siguiente éxito, pero no lo dejes con una dirección de un tenant ya borrado).
7. **`provision.lock` viejo.** Si un cierre brusco lo dejó, revisa que no haya otro `prod:provision` corriendo y bórralo a mano de `<workdir>`.
8. **Verificar el QR.** Tras provisionar, `https://<slug-del-curso>.<dominio-raiz>/api/assets/deuna-qr.<ext>` debe responder 200 con la imagen, o confirma el objeto en el panel de R2 bajo `t/<tenant-id>/assets/`. Un 404 significa que la subida no llegó: deshaz con `prod:undo-tenant` (punto 2) y provisiona de nuevo.

## 6. Después del cambio

1. Responsable: dueño. **+24 a 48 h** con Cloud estable: cambia el correo de Deuna a `d-<token>@in.<dominio-raiz>` (el contenido de `handover.txt`, mostrado solo en una terminal privada). La dirección antigua queda en el piloto durante los 14 días. Concilia los correos que lleguen al piloto con la importación de `.eml` del admin. Revertir: devuelve la dirección anterior en Deuna.
2. Responsable: dueño. **+14 días** sin incidentes: retira el piloto (borra o deja el Worker; **no** crees un Worker que solo redirija). Después `pnpm pilot:cleanup <workdir>`.
3. Responsable: dueño. Mezcla `feat/cloud` a `main` y etiqueta `pilot-final`.
4. Responsable: dueño. Con ese merge se retiran los scripts antiguos del piloto: `scripts/pending.sh` y `scripts/review.sh`.

## 7. Comportamientos conocidos

- `<ruta-heredada>//` (dos barras) responde 404. Una barra final se acepta y redirige igual.
- El núcleo de la guarda importa `src/worker/apex/legacy-redirects.ts`. Cualquier copia parcial del repositorio (por ejemplo en un directorio temporal) debe incluir ese archivo, o la guarda no carga.
- Salvo `pnpm prod:guard`, los envoltorios `prod:*` y `pilot:*` muestran un error crudo de Node con un Node viejo (ver 0.1).
- Los comprobantes no se migran. Las portadas tampoco: se vuelven a subir desde el admin.
- Si la importación se hace con el piloto escribiendo (un correo de Deuna), el tercer export lo detecta con un hash distinto. Sin escrituras en Cloud: `prod:undo-data` y reimporta. Con escrituras: concilia a mano.
