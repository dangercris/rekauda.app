# Cómo contribuir

Gracias por querer mejorar Rekauda. Este documento explica cómo preparar el entorno, qué convenciones sigue el código y cómo proponer cambios.

## Preparar el entorno

Requisitos: Node.js 22 o superior y pnpm 9 o superior.

```bash
pnpm install
```

Crea `.dev.vars` con valores de prueba (el archivo está en `.gitignore`; nunca uses secretos reales):

```bash
printf 'ADMIN_PASSWORD=clave-local\nFORWARD_TO=tesoreria@ejemplo.com\n' > .dev.vars
```

```bash
pnpm db:migrate:local
```

Dos terminales:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

El panel de administración usa una cookie `__Host-` con `Secure`: Safari no la acepta sobre `http://localhost`, así que usa Chrome o Firefox para el panel en local.

El Worker queda en `http://localhost:8799` y Vite redirige `/api` hacia él. Con `pnpm dev:web` también puedes abrir `/gallery`, una guía de estilos solo para desarrollo que no se incluye en el build.

## Antes de abrir un pull request

Los tres comandos deben pasar:

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build
```

| Comando | Qué cubre |
| --- | --- |
| `pnpm typecheck` | `tsc` del Worker (`src/worker/tsconfig.json`) y del cliente (`src/client/tsconfig.json`) |
| `pnpm test` | Vitest con dos proyectos: `client` (jsdom, `src/client/**/*.test.{ts,tsx}`) y `worker` (node, `src/worker/**/*.test.ts`) |
| `pnpm build` | Compila con Vite a `dist/` |
| `pnpm types` | Regenera `worker-configuration.d.ts` si cambias bindings o secretos en `wrangler.jsonc` |

## Convenciones del código

| Tema | Convención |
| --- | --- |
| TypeScript | Modo `strict` en Worker y cliente, con `noUncheckedIndexedAccess`. El cliente suma `exactOptionalPropertyTypes`, `noUnusedLocals` y `verbatimModuleSyntax` |
| Contrato compartido | Los tipos de la API viven en `src/shared/api.ts`. Se cambia primero ahí y después Worker y cliente. Cada respuesta JSON del Worker usa `satisfies` contra esos tipos |
| Pruebas | Junto al código, como `archivo.test.ts` o `archivo.test.tsx`. Las del Worker son de funciones puras o con una base D1 simulada (`src/worker/test/`), sin runtime de Workers |
| Estilos | CSS Modules (`*.module.css`) y tokens de diseño (`src/client/design/tokens.css`). Los colores y espaciados salen de los tokens. Ver [DESIGN.md](DESIGN.md) |
| Producto | El propósito y los principios están en [PRODUCT.md](PRODUCT.md) |
| Textos de la interfaz | Español neutro de Ecuador (sin voseo), claros y breves. Los identificadores y comentarios del código van en inglés |
| Dinero | Siempre enteros en centavos. Las fechas de calendario son `YYYY-MM-DD` en hora de Ecuador (UTC-5, sin horario de verano) |
| Datos personales | Ninguno en pruebas, fixtures, registros ni documentación. Usa datos inventados (`tesoreria@ejemplo.com`, `0000000000`, nombres ficticios) |
| Seguridad | No aflojes la CSP (`public/_headers` y `src/worker/og.ts` deben coincidir), no pongas analíticas en el panel y no hagas que la automatización marque `pagado` |
| Registros | Una línea JSON con `message`. Nunca incluir correos, nombres de familias ni secretos |
| Migraciones | Archivos nuevos y numerados en `migrations/`. No edites migraciones ya aplicadas |

## Commits y pull requests

- Usa commits convencionales: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, con un alcance opcional, por ejemplo `fix(ui): corrige el espaciado del título`.
- Un cambio por pull request, lo más pequeño posible para que se pueda revisar.
- Describe qué cambia, por qué, y cómo lo probaste. Si cambia lo que ve el usuario, incluye capturas sin datos reales.
- Si cambias el contrato de la API, las tablas, los secretos o el despliegue, actualiza también la documentación en `docs/`.

## Cómo proponer cambios

1. Para errores y mejoras, abre primero un issue contando el problema. No incluyas datos de familias, comprobantes, números de cuenta ni números de transacción reales.
2. Para cambios grandes (nuevos medios de pago, otros formatos de correo, cambios de modelo de datos), conversa la idea en el issue antes de escribir código.
3. Haz un fork, crea una rama, aplica el cambio con pruebas, ejecuta los tres comandos de arriba y abre el pull request.
4. Para vulnerabilidades, no abras un issue público con detalles explotables: contacta primero a quien administra el repositorio.

## Configuración de tu instancia

Los valores propios de cada curso (colegio, cuenta de cobro, bancos, analíticas) están en `rekauda.config.ts` y los de Cloudflare en `wrangler.jsonc`. Ambos son locales, están en `.gitignore` y se crean desde `rekauda.config.example.ts` y `wrangler.example.jsonc` con `scripts/ensure-config.mjs` (se ejecuta solo antes de dev, build, test, typecheck y deploy). Las pruebas usan siempre la configuración de ejemplo, así que no dependen de tus datos. Nunca subas `rekauda.config.ts`, `wrangler.jsonc` ni `public/deuna-qr.png`. Si agregas un campo de configuración, defínelo en `src/shared/instance-config.ts`, valídalo en `src/shared/instance-validation.ts`, añádelo a la plantilla de ejemplo y documéntalo en [docs/DESPLIEGUE-CLOUDFLARE.md](docs/DESPLIEGUE-CLOUDFLARE.md#5-personaliza-tu-instancia).

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la [licencia MIT](LICENSE) del proyecto.
