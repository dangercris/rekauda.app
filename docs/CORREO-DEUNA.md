# Confirmación automática con el correo de Deuna

Cuando alguien te transfiere por Deuna, la app de Deuna envía a tu cuenta un correo con el asunto "¡Recibiste $X en tu cuenta Deuna!". Esta guía hace que ese correo llegue también a Rekauda, que lo verifica, lo registra como movimiento bancario y, si coincide con un pago registrado por una familia, lo pasa a `recibido`. La persona de tesorería sigue marcando `pagado` a mano.

Es opcional. Sin esto, todo funciona igual, solo que la revisión es 100 % manual.

## Cómo funciona

1. Cambias el correo de la cuenta Deuna a una dirección secreta de tu dominio, por ejemplo `deuna-<aleatorio>@tu-dominio.ec`.
2. Cloudflare Email Routing entrega todo lo que llega a esa dirección al Worker.
3. El Worker reenvía primero el mensaje al correo real del tesorero (`FORWARD_TO`). Siempre, sin excepciones.
4. Después verifica que el correo sea realmente de Deuna (remitente y firma DKIM), lo interpreta y lo guarda.

Detalles técnicos en [ARQUITECTURA.md](ARQUITECTURA.md#pipeline-del-correo-de-deuna).

## Antes de empezar

- El Worker ya está desplegado en tu dominio ([DESPLIEGUE-CLOUDFLARE.md](DESPLIEGUE-CLOUDFLARE.md)).
- El dominio está en Cloudflare, en la misma cuenta.
- `treasury.accountNumber` en tu `rekauda.config.ts` es el número de tu cuenta Deuna. El Worker compara sus últimos 4 dígitos con la cuenta de destino del correo y descarta los correos de otra cuenta.
- Tienes acceso a la cuenta Deuna (para cambiar su correo) y al buzón real del tesorero.

## Pasos

### 1. Activar Email Routing en el dominio

En el panel de Cloudflare: tu dominio, **Email**, **Email Routing**, y sigue el asistente para activarlo. Cloudflare agrega registros DNS (MX y TXT) a tu zona.

Atención: esos registros reemplazan el correo entrante actual del dominio. Si ya recibes correo en ese dominio con otro proveedor, consulta la documentación de Email Routing sobre subdominios antes de continuar.

**Cómo verificar.** El panel de Email Routing muestra el estado como activo y sin errores de DNS.

### 2. Agregar y verificar el correo de destino

1. En Email Routing, pestaña **Destination addresses** (direcciones de destino), agrega el correo real del tesorero.
2. Cloudflare envía un mensaje de verificación a ese buzón. Abre el enlace.

**Cómo verificar.** La dirección aparece como verificada.

### 3. Configurar `FORWARD_TO`

El valor debe ser exactamente la dirección verificada en el paso anterior.

```bash
pnpm exec wrangler secret put FORWARD_TO
```

Si no coincide con una dirección verificada, el reenvío falla (`deuna_mail_forward_failed` en los registros). El análisis del correo sigue adelante, pero el tesorero no recibe copia.

**Cómo verificar.**

```bash
pnpm exec wrangler secret list
```

### 4. Crear la dirección secreta y enviarla al Worker

1. En Email Routing, pestaña **Routing rules**, sección **Custom addresses**, crea una dirección.
2. Elige un nombre largo y aleatorio. Para generarlo:

```bash
openssl rand -hex 8
```

3. Como dirección usa `deuna-<aleatorio>@tu-dominio.ec` (reemplaza `<aleatorio>` por lo que imprimió el comando).
4. En **Action** elige **Send to a Worker** y como destino elige el Worker de tu instancia (el valor de `name` en `wrangler.jsonc`).
5. Guarda y asegúrate de que la regla esté activa.

Los nombres de los menús pueden variar un poco si Cloudflare actualiza su panel.

**Cómo verificar.** La regla aparece en la lista, activa, apuntando a tu Worker.

### 5. Cambiar el correo en la app de Deuna

Cambia el correo de tu cuenta Deuna por la dirección secreta. La opción está en los datos de tu cuenta o perfil; la ruta exacta depende de la versión de la app.

Deuna enviará un código de verificación a la nueva dirección. Como el Worker reenvía todo primero, el código llega a tu buzón real. Ese correo no es una notificación de pago, así que en los registros aparecerá como `sender_not_deuna` o `not_a_payment`, según quién lo envíe. Es lo esperado.

**Cómo verificar.** Deuna confirma el cambio de correo.

### 6. Pruebas

**Prueba A: correo normal.** Desde tu correo personal, escribe a la dirección secreta. Debes ver:

- El mensaje llega a tu buzón real (el del tesorero).
- En los registros del Worker aparece `deuna_mail_ignored` con `reason: sender_not_deuna`.

**Prueba B: transferencia real pequeña.** Pide a alguien de confianza que transfiera un monto pequeño (por ejemplo, USD 1,00) a tu cuenta Deuna. Debes ver:

- El correo "Recibiste" en tu buzón real.
- En los registros, `deuna_mail_stored`, seguido de `deuna_mail_matched` (si existe un pago que coincide) o `deuna_mail_unmatched`.
- En el panel, **Movimientos** (`#movimientos`) muestra el movimiento si quedó sin vincular. Si se vinculó, el pago aparece como `recibido` con la nota "Confirmado por notificación de Deuna".

Para probar la vinculación completa, registra antes en la app un pago por el mismo monto, con la fecha de hoy y con el nombre de quien transfiere.

### Cómo leer los registros

En el panel de Cloudflare: **Workers & Pages**, tu Worker, **Observability**, y busca el texto `deuna_mail`. Cada evento es una línea JSON con el campo `message`.

`wrangler tail` muestra solo lo que ocurre mientras está conectado y no guarda historial. En pruebas con correos hemos visto que puede no mostrar los eventos de `email()`, por eso la guía usa el panel de Observability, que conserva y permite buscar.

Los registros no incluyen tu correo de reenvío. Incluyen número de transacción y montos, pero no el nombre del ordenante (ese solo queda en la base D1).

## Importar un correo a mano (.eml)

Sirve para correos que se perdieron o llegaron antes de configurar todo.

1. En Gmail, abre el correo original de Deuna, menú de tres puntos, **Descargar mensaje**. Se guarda un archivo `.eml`.
2. En el panel, abre **Movimientos** (`#movimientos`) y usa **Importar correo de Deuna (.eml)**.
3. El resultado dice si se guardó, si ya existía (duplicado) o por qué se ignoró.

Debe ser el mensaje original. Si lo reenvías o lo copias como texto, se pierde la firma y el correo se rechaza con `dkim_failed` o `no_signature`. Tamaño máximo: 1 MB.

## Solución de problemas

Cada fila corresponde a un evento de los registros (y al motivo que muestra la importación del panel).

| Evento y motivo | Qué significa | Qué hacer |
| --- | --- | --- |
| `deuna_mail_ignored`, `sender_not_deuna` | El remitente no es `notificaciones@deunaapp.com` | Normal para pruebas, spam o el código de verificación. Si debería ser Deuna, revisa el remitente real |
| `deuna_mail_ignored`, `dkim_failed` | La firma DKIM no valida. El campo `detail` trae el último motivo y `signatures` el resultado de cada firma (dominio `d`, selector `s` y motivo) | Ver la tabla de motivos DKIM más abajo |
| `deuna_mail_dkim_unavailable` (nivel error) | No se pudo consultar la clave pública de DKIM por DNS, tras reintentos. No es un veredicto sobre el correo | Reimporta el `.eml` más tarde desde Movimientos. Si se repite, revisa si hay una caída de DNS |
| `deuna_mail_ignored`, `not_a_payment` | El correo es de Deuna pero no tiene los datos de un pago. `missing` lista las piezas que faltaron | Normal en códigos de verificación y promociones. Si era un pago real, ver tabla de piezas más abajo |
| `deuna_mail_wrong_account` | La cuenta de destino no termina en los últimos 4 dígitos de `treasury.accountNumber` | Revisa que `rekauda.config.ts` tenga el número de tu cuenta y que el despliegue esté actualizado |
| `deuna_mail_duplicate` | Esa transacción ya estaba guardada (Deuna o Email Routing entregaron dos veces) | Nada. No se duplica el movimiento |
| `deuna_mail_forward_failed` | No se pudo reenviar a `FORWARD_TO` | Verifica que `FORWARD_TO` sea idéntico a la dirección verificada en Email Routing. El análisis continuó igual |
| `deuna_mail_ignored`, `too_large` | El mensaje pesa más de 1 MB | No es un correo normal de Deuna. Ignóralo |
| `deuna_mail_read_failed` | No se pudo leer el contenido del mensaje | El reenvío se intentó igual. Reimporta el `.eml` si era un pago |
| `deuna_mail_error` | Fallo inesperado al guardar o analizar (por ejemplo la base de datos) | Revisa el campo `error` y reimporta el `.eml` |
| `deuna_mail_stored` | Movimiento guardado | Normal. Mira el siguiente evento |
| `deuna_mail_matched` | Se vinculó a un pago (puntaje en `score`) y el pago pasó a `recibido` | Normal. Tesorería verifica y marca `pagado` |
| `deuna_mail_unmatched` | Ningún pago coincide con claridad (campo `candidates`) | Vincula manualmente en **Movimientos** |
| `deuna_mail_link_skipped` y `deuna_mail_link_failed` | El pago o el movimiento cambiaron mientras se vinculaba, por ejemplo otro movimiento tomó el pago | El movimiento queda para vincular a mano |
| `payment_movement_matched`, `payment_movement_ambiguous` y `payment_movement_match_failed` | Lo mismo en el orden inverso: el pago se registró después del correo. `ambiguous` indica que un movimiento encaja con más de un pago | Si queda ambiguo, vincula a mano |

### Motivos de `dkim_failed`

| `detail` | Causa probable |
| --- | --- |
| `no_signature` | El mensaje no tiene firma. Suele pasar al reenviar o copiar el correo en lugar de descargar el original |
| `domain_mismatch` | La firma es de otro dominio (por ejemplo del servicio de envío). Si en `signatures` hay otra firma válida de `deunaapp.com`, el correo pasa |
| `body_hash_mismatch` y `signature_mismatch` | El mensaje fue modificado después de firmarse (reenviado, editado, o falsificado) |
| `key_unavailable` | No se obtuvo la clave pública (se informa aparte como `dkim_unavailable`) |
| `key_invalid` | La clave publicada no es utilizable |
| `from_not_signed` | La firma no cubre el encabezado `From` |
| `multiple_from` | El mensaje trae más de un `From` |
| `expired` | La firma tenía fecha de vencimiento y venció |
| `malformed_message`, `malformed_signature` | Estructura rota o ilegible |
| `unsupported_algorithm`, `unsupported_version`, `unsupported_canonicalization`, `body_length_limit` | Firma con opciones que el verificador no admite a propósito (solo `rsa-sha256`, sin `l=`) |

### Piezas faltantes en `not_a_payment`

| `missing` | Significado |
| --- | --- |
| `content` | No hubo texto ni HTML que leer |
| `details_heading` | No aparece el encabezado "Detalles de tu pago" (típico de códigos de verificación) |
| `intro` | Falta la frase inicial "Recibiste $X de ... con Deuna" |
| `label_*` (transacción, ordenante, cuenta de destino, cuenta de origen, fecha, monto, motivo) | Falta alguna etiqueta del cuadro de detalles |
| `amount`, `amount_matches_intro` | El monto no se pudo leer o no coincide con la frase inicial |
| `payer_name`, `payer_matches_intro` | El ordenante falta o no coincide con la frase inicial |
| `date`, `label_date_with_valid_date` | La fecha no tiene el formato esperado |
| `transaction_number` | El número de transacción no tiene entre 6 y 20 dígitos |
| `destination_account` | La cuenta de destino no se pudo leer |

Si un pago real aparece con piezas faltantes de forma repetida, Deuna probablemente cambió el formato del correo. Abre un issue en el repositorio sin pegar datos personales: basta con el campo `missing`.

## Rekauda Cloud (varios cursos en una sola instalación)

Esta sección es para quien opera la versión Cloud. Si autoalojas Rekauda, ignórala: todo lo anterior sigue igual.

En Cloud no hay una regla de Email Routing por curso. Hay una sola regla catch-all en un subdominio de entrada (`INBOUND_DOMAIN`, por ejemplo `in.tu-dominio.net`) que entrega todo al Worker. El curso se identifica por la dirección de destino, que tiene la forma `d-<token>@INBOUND_DOMAIN`:

- El token son entre 16 y 64 caracteres en minúscula y números, por ejemplo el resultado de `openssl rand -hex 16`. En la base de datos solo se guarda su SHA-256 (`tenants.inbound_token_hash`), nunca el token.
- Una dirección desconocida, de otro dominio o con variantes como `d-<token>+algo@...` se rechaza antes de leer el mensaje, sin guardar ni reenviar nada. Los registros no incluyen la dirección.
- El orden es siempre el mismo: leer el mensaje (máx. 1 MB), verificar remitente y DKIM una sola vez, avisar a la tesorería, archivar el original y recién después procesar. Si un paso falla, se registra y los demás siguen.
- El aviso es un correo a los dueños y cotesoreros del curso. **El original se adjunta como `correo.eml` solo si es un correo de Deuna verificado** (remitente exacto y DKIM con `d=deunaapp.com`). Cualquier otro mensaje (sin firma, remitente falso, clave DNS no disponible) genera un aviso solo de texto: "Llegó un correo que no pudimos verificar como de Deuna; revisa tu cuenta de Deuna". Así la dirección secreta no sirve para hacer llegar contenido ajeno a la tesorería. Los mensajes de más de 1 MB o ilegibles también van sin adjunto, con un texto distinto.
- Cada curso tiene un tope de avisos por minuto (limitador `LOOKUP_LIMITER`, clave `inbound-notice:<id del curso>`). Pasado el tope no se envía aviso, pero el original se archiva y se procesa, y queda el registro `inbound_notice_capped`.
- Un curso sin dueños ni cotesoreros no puede recibir avisos: su correo se rechaza antes de leerlo (`inbound_mail_no_recipients`). Si el aviso falla y además el archivo falla o no existe, se registra `deuna_mail_lost` como error, para poder crear una alerta. Después de leer el mensaje ya no se intenta rechazarlo.
- El original se guarda en el bucket aparte `MAIL_ARCHIVE`, con la clave `t/<id del curso>/<AAAA-MM-DD>/<uuid>.eml`.
- La verificación (remitente exacto y DKIM con `d=deunaapp.com`) y el análisis son los mismos de siempre. Solo se comparan los pagos del curso destinatario, y la automatización nunca marca `pagado`.

### Retención de 30 días

Un cron diario (`triggers.crons` en `wrangler.cloud.example.jsonc`, handler `scheduled()`) elimina los originales con más de 30 días según la fecha de la clave. Es solo configuración: empieza a correr cuando se despliega esa configuración.

Como segunda capa recomendada, y como paso manual del dueño, crea una regla de ciclo de vida en el bucket `MAIL_ARCHIVE` que elimine los objetos a los 30 días. En el panel de Cloudflare: **R2**, el bucket de correo, **Settings**, **Object lifecycle rules**, regla de eliminación a los 30 días sobre todos los objetos. Se hace una sola vez, a mano, y no forma parte de ningún script.

**Cómo verificar.** La regla aparece en la lista del bucket con 30 días y los registros muestran `mail_archive_purged` una vez al día.

### Verificaciones pendientes en un entorno real (lista de sandbox)

Nada de esto está comprobado todavía, porque las pruebas automáticas usan dobles:

- Que `send_email` acepte el adjunto `message/rfc822` (tamaño máximo y cuotas incluidos).
- Dónde cae el aviso con adjunto `.eml` (bandeja o spam) y si el remitente `no-reply@` del dominio raíz está incorporado.
- Que se invoque una vez por destinatario y que un destinatario con error no impida los demás.
- Que la dirección de destino del mensaje llegue como `d-<token>@INBOUND_DOMAIN` con el catch-all, y que un destinatario desconocido se rechace sin leer el cuerpo.
- Un correo real de Deuna de punta a punta (DKIM verificado, aviso con adjunto, movimiento registrado).

## Seguridad

- **Mantén la dirección secreta.** Quien la conozca puede enviarle correos al Worker. No la publiques en la página, en WhatsApp ni en el repositorio.
- **La firma DKIM es obligatoria.** Un correo que simule ser de Deuna pero no tenga la firma válida de `deunaapp.com` se descarta. Deuna publica DMARC con política `p=none`, así que el proveedor de correo no rechazaría el engaño por sí solo; por eso la verificación se hace dentro del Worker.
- **La automatización nunca marca `pagado`.** Como máximo pasa un pago a `recibido`. Siempre debes comprobar el dinero en tu banco.
- **Cada mensaje se reenvía primero.** Aunque el análisis falle, tienes el original en tu buzón.
- **Si la dirección se filtra:** crea una dirección nueva en Email Routing (paso 4), cámbiala en la app de Deuna (paso 5) y elimina o desactiva la regla anterior.
- Los números de transacción y montos de los movimientos quedan en D1. Bórralos al terminar (ver [OPERACION.md](OPERACION.md#después-del-evento-borrar-comprobantes-y-datos)).
