import { useEffect, useState, type ReactNode } from "react";
import type { PaymentStatus } from "../../shared/api";
import { PAYMENT_STATUSES } from "../../shared/api";
import { CLASS_MARK, CLASS_SHORT_NAME, TREASURY } from "../../shared/instance";
import {
  EventThemeProvider,
  contrastRatio,
  eventVars,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from "../design";
import { cx } from "../lib/cx";
import { formatMoney, plural } from "../lib/format";
import {
  ActionBar,
  AmbientBackground,
  Avatar,
  Badge,
  BrandPill,
  Button,
  Card,
  CheckItem,
  CheckList,
  Checkbox,
  Chip,
  CopyRow,
  Counter,
  EmptyState,
  FileDrop,
  Hero,
  ICON_NAMES,
  Icon,
  IconButton,
  IconTile,
  InfoNote,
  InlineConfirm,
  KeyValue,
  ListGroup,
  ListItem,
  ListRow,
  Money,
  Notice,
  NumberedSteps,
  PageHeader,
  ProgressBar,
  RadioCards,
  SectionHeader,
  SegmentedBar,
  SegmentedControl,
  SelectField,
  Sheet,
  SheetLayout,
  Skeleton,
  StatTile,
  StatusPill,
  Stepper,
  SwatchPicker,
  TabBar,
  TextArea,
  TextField,
  Timeline,
  ToastProvider,
  Toggle,
  TopBar,
  useToast,
} from "../ui";
import styles from "./Gallery.module.css";
import { BRIGHT_COVER, DARK_COVER, SAMPLE_PDF, SAMPLE_TONES, makeSampleReceipt } from "./samples";

type CoverMode = "none" | "bright" | "dark";

const COVERS: Record<CoverMode, string | null> = { none: null, bright: BRIGHT_COVER, dark: DARK_COVER };

export function Gallery() {
  const [tone, setTone] = useState<string>(SAMPLE_TONES[0].value);
  const [cover, setCover] = useState<CoverMode>("dark");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Recaudo Escolar · solo desarrollo</p>
          <h1 className={styles.h1}>Galería de componentes</h1>
          <p className={styles.lead}>Cada componente en sus estados, en claro y oscuro, con el tono y la portada elegidos.</p>
        </div>
        <EventThemeProvider tone={tone} className={styles.controls}>
          <SegmentedControl
            label="Tono de ejemplo"
            value={tone}
            onChange={setTone}
            options={SAMPLE_TONES.map((t) => ({ value: t.value, label: t.name }))}
          />
          <SegmentedControl
            label="Portada de ejemplo"
            value={cover}
            onChange={setCover}
            options={[
              { value: "dark", label: "Foto oscura" },
              { value: "bright", label: "Foto clara" },
              { value: "none", label: "Sin portada" },
            ]}
          />
        </EventThemeProvider>
      </header>
      <ToneTable />
      <div className={styles.panels}>
        {(["light", "dark"] as const).map((scheme) => (
          <section key={scheme} data-theme={scheme} className={styles.panel} aria-label={scheme === "light" ? "Tema claro" : "Tema oscuro"}>
            <EventThemeProvider tone={tone} coverUrl={COVERS[cover]} scheme={scheme} className={styles.panelInner}>
              <ToastProvider>
                <AmbientBackground mode="contained" />
                <p className={styles.panelLabel}>{scheme === "light" ? "Claro" : "Oscuro"}</p>
                <Showcase />
              </ToastProvider>
            </EventThemeProvider>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tone table

function ToneTable() {
  return (
    <section className={styles.toneTable} aria-label="Tonos de ejemplo y contraste">
      {SAMPLE_TONES.map((t) => {
        const light = eventVars(t.value, false);
        const dark = eventVars(t.value, true);
        const rows: Array<[string, string, string]> = [
          ["--ev-ink sobre --ev", light["--ev-ink"], contrastRatio(light["--ev-ink"], t.value).toFixed(2)],
          ["--ev-text claro", light["--ev-text"], contrastRatio(light["--ev-text"], SURFACE_LIGHT).toFixed(2)],
          ["--ev-text oscuro", dark["--ev-text"], contrastRatio(dark["--ev-text"], SURFACE_DARK).toFixed(2)],
        ];
        return (
          <div key={t.value} className={styles.toneCard}>
            <div className={styles.toneSwatches}>
              <span style={{ background: t.value }} />
              <span style={{ background: light["--ev2"] }} />
              <span style={{ background: light["--ev3"] }} />
            </div>
            <strong>
              {t.name} <span className="mono">{t.value}</span>
            </strong>
            <dl className={styles.toneRows}>
              {rows.map(([name, value, ratio]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd className="mono">
                    <span className={styles.chipSwatch} style={{ background: value }} />
                    {value} · {ratio}:1
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------- showcase (rendered once per scheme)

function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={cx(styles.block, wide && styles.wide)}>
      <h2 className={styles.blockTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <div className={cx(styles.row, wrap && styles.wrap)}>{children}</div>;
}

const SAMPLE_PAYMENTS: Array<{ name: string; parent: string; event: string; tone: string; cents: number; status: PaymentStatus; ago: string; note?: string }> = [
  { name: "Mateo Andrade", parent: "Carolina Vásquez", event: "Navidad", tone: "#C81E3A", cents: 1400, status: "en_revision", ago: "hace 23 min" },
  { name: "Valentina Ruiz", parent: "Jorge Ruiz", event: "Cotopaxi", tone: "#3D4FA3", cents: 2800, status: "recibido", ago: "hace 1 h" },
  { name: "Martín Salazar", parent: "Luis Salazar", event: "Materiales", tone: "#0B7A73", cents: 500, status: "observado", ago: "ayer", note: "Monto incompleto · faltan $5,00" },
  { name: "Isabella Cedeño", parent: "Paola Cedeño", event: "Navidad", tone: "#C81E3A", cents: 1400, status: "pagado", ago: "ayer" },
  { name: "Lucas Cevallos", parent: "Andrea Mena", event: "Materiales", tone: "#0B7A73", cents: 1000, status: "anulado", ago: "lun" },
];

function Showcase() {
  const toast = useToast();
  const [status, setStatus] = useState<"todos" | "revision" | "pagados" | "observados">("revision");
  const [option, setOption] = useState<"mujer" | "hombre" | null>("mujer");
  const [students, setStudents] = useState(1);
  const [notify, setNotify] = useState(true);
  const [reminder, setReminder] = useState(false);
  const [consent, setConsent] = useState(false);
  const [bank, setBank] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(SAMPLE_PDF);
  const [empty, setEmpty] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(true);
  const [reason, setReason] = useState("Monto incompleto");
  const [loading, setLoading] = useState(false);
  const [pickTone, setPickTone] = useState<string>(SAMPLE_TONES[0].value);
  const [tab, setTab] = useState<"resumen" | "pagos" | "eventos" | "ajustes">("pagos");

  useEffect(() => {
    let alive = true;
    void makeSampleReceipt().then((f) => {
      if (alive) setFile(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={styles.showcase}>
      <Block title="Identidad y encabezados">
        <Row wrap={false}>
          <BrandPill mark={CLASS_MARK} title="Comité de Padres" subtitle={CLASS_SHORT_NAME} />
          <IconButton icon="share" label="Compartir evento" />
        </Row>
        <PageHeader
          eyebrow={`Tesorería · ${CLASS_SHORT_NAME}`}
          title="Resumen"
          subtitle="Jueves 26 de noviembre"
          actions={
            <>
              <IconButton icon="bell" label="Notificaciones, 7 pendientes" dot />
              <Avatar name="Tesorería Curso" variant="ink" size={42} decorative={false} />
            </>
          }
        />
        <TopBar title="Verificar pago" backHref="#" backLabel="Volver a pagos" trailing={<Chip variant="glass" size="sm">NAV-021</Chip>} />
      </Block>

      <Block title="Hero">
        <Hero
          eyebrow="Viernes 18 de diciembre"
          title="Musical de Navidad 2026"
          description="Vestuario para la obra de fin de año del paralelo."
          coverAlt=""
          topStart={<Chip variant="on-image" dot="live">Recaudación abierta</Chip>}
          topEnd={<Chip variant="on-image" icon="clock">Faltan 16 días</Chip>}
          overlap={
            <Card radius="2xl" padding="md">
              <div className={styles.priceRow}>
                <div className={styles.stack4}>
                  <span className={styles.caption}>Valor por estudiante</span>
                  <Money cents={1400} variant="display" />
                </div>
                <div className={styles.deadline}>
                  <span className={styles.caption}>Paga hasta el</span>
                  <span className={styles.deadlineValue}>sáb 12 dic</span>
                  <span className={styles.deadlineHint}>hasta las 23:59</span>
                </div>
              </div>
              <div className={styles.stack8}>
                <ProgressBar value={21 / 32} label="Familias que ya pagaron" valueText="21 de 32" />
                <div className={cx(styles.progressMeta, "num")}>
                  <span>
                    <strong>21 de 32</strong> familias ya pagaron
                  </span>
                  <span>
                    <Money cents={29400} compact /> de <Money cents={44800} compact />
                  </span>
                </div>
              </div>
            </Card>
          }
        />
        <Hero size="md" headingLevel={2} eyebrow="Sábado 23 de enero" title="Excursión al Cotopaxi" coverUrl={null} aside={<Chip variant="event">$28,00</Chip>} topStart={<Chip variant="on-image">Vista previa</Chip>} topEnd={<Button variant="on-image" size="sm" iconStart="image">Cambiar imagen</Button>} />
      </Block>

      <Block title="Botones">
        <Row>
          <Button variant="event" size="lg" iconEnd="external">Abrir Deuna y pagar $14,00</Button>
        </Row>
        <Row>
          <Button variant="event" iconStart="upload">Subir comprobante</Button>
          <Button variant="ink">Guardar</Button>
          <Button variant="glass" iconStart="download">Exportar CSV</Button>
        </Row>
        <Row>
          <Button variant="ok" iconStart="check">Verificar pago</Button>
          <Button variant="danger-soft" iconStart="x">Rechazar</Button>
          <Button variant="danger">Anular</Button>
        </Row>
        <Row>
          <Button variant="soft" size="sm" iconStart="expand">Ampliar</Button>
          <Button variant="glass" size="sm" iconStart="copy">Copiar</Button>
          <Button variant="ghost" size="sm">Ver los 7</Button>
          <Button variant="ink" size="sm">Recordar</Button>
        </Row>
        <Row>
          <Button
            variant="event"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1800);
            }}
          >
            Enviar comprobante
          </Button>
          <Button variant="event" loading>Enviando</Button>
          <Button variant="event" disabled>Deshabilitado</Button>
        </Row>
        <Button variant="event" size="lg" fullWidth href="#" iconEnd="arrow-right">Enlace a ancho completo</Button>
      </Block>

      <Block title="Botones de ícono">
        <Row>
          <IconButton icon="share" label="Compartir" />
          <IconButton icon="chevron-left" label="Volver" variant="soft" />
          <IconButton icon="plus" label="Agregar" variant="ink" />
          <IconButton icon="check" label="Confirmar" variant="event" />
          <IconButton icon="x" label="Cerrar" variant="ghost" size={40} />
          <IconButton icon="bell" label="Avisos" dot size={44} />
          <span className={styles.onImage}>
            <IconButton icon="share" label="Compartir sobre imagen" variant="on-image" size={40} />
          </span>
        </Row>
      </Block>

      <Block title="Íconos">
        <div className={styles.iconGrid}>
          {ICON_NAMES.map((name) => (
            <span key={name} className={styles.iconCell} title={name}>
              <Icon name={name} size={20} />
              <span className="mono">{name}</span>
            </span>
          ))}
        </div>
      </Block>

      <Block title="Chips, insignias y estados">
        <Row>
          <Chip variant="soft" size="sm" dot>Musical · $14,00</Chip>
          <Chip variant="strong" size="sm" icon="calendar">Vie 18 dic</Chip>
          <Chip onClick={() => undefined} selected>Todos los eventos</Chip>
          <Chip onClick={() => undefined} dot="event">Navidad</Chip>
        </Row>
        <Row>
          <Chip variant="strong" onClick={() => undefined} selected selectedTone="bad">Monto incompleto</Chip>
          <Chip variant="strong" onClick={() => undefined}>Comprobante ilegible</Chip>
          <Badge count={7} label="7 pendientes" />
          <Badge count={128} />
        </Row>
        <Row>
          {PAYMENT_STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </Row>
        <Row>
          {PAYMENT_STATUSES.map((s) => (
            <StatusPill key={s} status={s} size="sm" />
          ))}
        </Row>
      </Block>

      <Block title="Dinero">
        <Money cents={169600} variant="display" />
        <Row>
          <Money cents={82700} variant="stat" />
          <Money cents={1400} variant="title" />
          <span>
            Inline: <Money cents={2800} /> · compacto <Money cents={31500} compact />
          </span>
        </Row>
      </Block>

      <Block title="Formulario">
        <TextField label="Nombre del estudiante" defaultValue="Mateo Andrade" autoComplete="off" />
        <TextField label="Teléfono" type="tel" inputMode="tel" placeholder="09X XXX XXXX" hint="Solo para avisarte si hay un problema con tu pago." />
        <TextField label="Monto transferido" prefix="$" inputMode="decimal" defaultValue="14,00" error="El monto no coincide con el valor de 1 estudiante ($14,00)." />
        <TextField label="Nº de transacción" optional mono placeholder="Ej. 0045 8812" />
        <TextField label="Campo deshabilitado" defaultValue="No editable" disabled />
        <SelectField
          label="Banco desde el que pagaste"
          placeholder="Elige tu banco"
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          options={["Banco Pichincha", "Banco Guayaquil", "Produbanco", "Deuna"].map((b) => ({ value: b, label: b }))}
        />
        <TextArea label="Descripción corta" defaultValue="Vestuario para la obra de fin de año." hint="Máximo 160 caracteres." />
        <Checkbox label="Autorizo el uso de estos datos solo para registrar este pago." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <Checkbox label="Acepto los términos" error="Debes aceptar para continuar." />
      </Block>

      <Block title="Selección">
        <SegmentedControl
          label="Filtrar por estado"
          size="tall"
          value={status}
          onChange={setStatus}
          options={[
            { value: "todos", label: "Todos", count: 64 },
            { value: "revision", label: "En revisión", count: 7 },
            { value: "pagados", label: "Pagados", count: 56 },
            { value: "observados", label: "Observados", count: 1 },
          ]}
        />
        <RadioCards
          legend="Tipo de vestuario"
          value={option}
          onChange={setOption}
          options={[
            { value: "mujer", label: "Vestuario de mujer", detail: "Vestido y accesorios", cents: 1400 },
            { value: "hombre", label: "Vestuario de hombre", detail: "Traje y sombrero", cents: 1400 },
          ]}
        />
        <Counter label="Estudiantes" description="Hasta 4 por pago" value={students} min={1} max={4} onChange={setStudents} format={(n) => n} />
        <p className={styles.caption}>{plural(students, "estudiante", "estudiantes")} · total {formatMoney(students * 1400)}</p>
        <Stepper steps={["Datos", "Comprobante", "Confirmar"]} current={1} />
        <Stepper steps={["Datos", "Comprobante", "Confirmar"]} current={3} />
      </Block>

      <Block title="Interruptores y tono">
        <Card padding="md" gap={0}>
          <Toggle label="Correo al verificar el pago" description="Avisa cuando el pago queda confirmado" checked={notify} onChange={setNotify} />
          <Toggle label="Recordatorio antes del límite" description="Correo 2 días antes a quienes no han pagado" checked={reminder} onChange={setReminder} />
          <Toggle label="Deshabilitado" checked={false} onChange={() => undefined} disabled />
        </Card>
        <Row>
          <Toggle bare label="Avisar por correo" checked={notify} onChange={setNotify} />
          <Toggle bare label="Tono del evento" tone="event" checked onChange={() => undefined} />
        </Row>
        <SwatchPicker legend="Tono del evento" swatches={SAMPLE_TONES.map((t) => ({ ...t, role: t.role }))} value={pickTone} onChange={setPickTone} />
      </Block>

      <Block title="Datos para pagar">
        <Card padding="lg" radius="3xl" gap={16}>
          <div className={styles.cardHead}>
            <IconTile icon="wallet" />
            <div>
              <h3 className={styles.cardTitle}>Paga con Deuna</h3>
              <span className={styles.caption}>Canal oficial de la tesorería · sin comisión</span>
            </div>
          </div>
          <ListGroup variant="strong" inset="text">
            <ListItem>
              <CopyRow label="Número Deuna" value="0991234567" display="099 123 4567" size="lg" mono hint="A nombre de la tesorería" />
            </ListItem>
            <ListItem>
              <CopyRow label="Concepto de la transferencia" value="Musical · nombre del estudiante" />
            </ListItem>
          </ListGroup>
          <Card variant="dashed" radius="lg" padding="sm">
            <div className={styles.cardHead}>
              <img src={TREASURY.qrUrl ?? "/icon.svg"} alt="Código QR de Deuna de la tesorería" className={styles.qr} />
              <div>
                <strong>¿Pagas desde otro teléfono?</strong>
                <p className={styles.caption}>Escanea el QR de la tesorería desde la app Deuna.</p>
              </div>
            </div>
          </Card>
        </Card>
        <div className={styles.kvGrid}>
          <KeyValue label="Estudiante" value="Mateo Andrade" />
          <KeyValue label="Monto" value={<Money cents={1400} />} />
          <KeyValue label="Nº de transacción" value="0045 8812" mono size="sm" />
          <KeyValue label="Código de seguimiento" value="NAV-021" mono size="sm" accent />
        </div>
      </Block>

      <Block title="Contenido del evento">
        <SectionHeader title="Qué cubre tu aporte" />
        <CheckList items={["Vestuario completo para la obra", "Accesorios y maquillaje", "Ajustes de talla"]} />
        <SectionHeader title="Cómo funciona" />
        <NumberedSteps
          steps={[
            { title: "Paga con Deuna", description: "Transfiere $14,00 al número de la tesorería." },
            { title: "Sube tu comprobante", description: "La captura de pantalla de Deuna, aquí mismo." },
            { title: "Recibe la confirmación", description: "Te avisamos cuando revisemos tu pago." },
          ]}
        />
        <InfoNote icon="shield">La tesorería nunca te pedirá claves, códigos de verificación ni datos de tu tarjeta.</InfoNote>
      </Block>

      <Block title="Seguimiento">
        <Card>
          <Timeline
            label="Estado del pago"
            items={[
              { id: "a", title: "Comprobante enviado", description: "Captura y datos recibidos", meta: "Hoy · 10:42", state: "done" },
              { id: "b", title: "En revisión por tesorería", description: "Suele tomar menos de 24 h", meta: "Ahora", state: "current" },
              { id: "c", title: "Pago confirmado", description: "Te avisaremos cuando quede listo", state: "pending" },
            ]}
          />
        </Card>
        <Card>
          <Timeline
            items={[
              { id: "a", title: "Comprobante enviado", meta: "Ayer · 18:10", state: "done" },
              { id: "b", title: "Con observación", description: "El monto no coincide: faltan $5,00.", meta: "Hoy · 09:02", state: "alert" },
              { id: "c", title: "Pago confirmado", state: "pending" },
            ]}
          />
        </Card>
      </Block>

      <Block title="Progreso y métricas">
        <Card gap={12}>
          <span className={styles.caption}>Recaudado y confirmado</span>
          <Money cents={82700} variant="display" />
          <SegmentedBar
            total={169600}
            legend
            label="Recaudado por evento: Navidad $315, Cotopaxi $252, Materiales $260 de $1.696"
            segments={[
              { key: "nav", value: 31500, color: "#C81E3A", label: "Navidad", display: "$315" },
              { key: "cot", value: 25200, color: "#3D4FA3", label: "Cotopaxi", display: "$252" },
              { key: "mat", value: 26000, color: "#0B7A73", label: "Materiales", display: "$260" },
            ]}
          />
        </Card>
        <SegmentedBar
          size="md"
          legend
          segments={[
            { key: "p", value: 21, color: "ok", label: "Pagado" },
            { key: "r", value: 4, color: "info", label: "Recibido" },
            { key: "e", value: 3, color: "warn", label: "En revisión" },
            { key: "o", value: 1, color: "bad", label: "Con observación" },
          ]}
        />
        <div className={styles.statGrid}>
          <StatTile label="En revisión" value="7" icon="clock" tone="warn" meta="$126,00 por revisar" metaToned href="#" />
          <StatTile label="Familias al día" value="58%" icon="check" tone="ok" meta="56 de 96 pagos esperados" />
        </div>
        <ProgressBar value={0.28} size="sm" label="Avance Cotopaxi" />
      </Block>

      <Block title="Listas">
        <SectionHeader title="Por revisar" action={{ label: "Ver los 7", href: "#" }} />
        <ListGroup label="Pagos recientes">
          {SAMPLE_PAYMENTS.map((p) => (
            <ListRow
              key={p.name}
              tone={p.tone}
              href="#"
              leading={<Avatar name={p.name} />}
              title={p.name}
              subtitle={
                <>
                  <span className={styles.eventName}>{p.event}</span> · {p.parent}
                </>
              }
              note={p.note}
              trailing={<Money cents={p.cents} />}
              trailingMeta={<StatusPill status={p.status} size="sm" />}
              chevron={false}
            />
          ))}
        </ListGroup>
        <SectionHeader title="Hoy" caption as="h3" />
        <ListGroup inset="leading">
          <ListRow leading={<IconTile icon="check" size={38} tone="ok" />} title="Confirmaste el pago de Sebastián Mora" subtitle="Navidad" trailing="08:10" />
          <ListRow leading={<IconTile icon="mail" size={38} tone="neutral" />} title="Correo enviado a Ana Lucía Pérez" trailing="08:04" />
          <ListRow onClick={() => undefined} leading={<IconTile icon="settings" size={38} tone="event" />} title="Ajustes del evento" subtitle="Fecha, valores y portada" />
        </ListGroup>
      </Block>

      <Block title="Avisos y confirmación en línea">
        <Notice icon="clock" title="Materiales vence en 8 días" description="6 familias aún no pagan" action={<Button variant="ink" size="sm">Recordar</Button>} />
        <Notice iconStyle="solid" tone="ok" icon="check" title="Pago confirmado" description="Correo enviado a la representante" action={<Button variant="soft" size="sm">Deshacer</Button>} />
        <Notice iconStyle="solid" tone="bad" icon="x" title="Pago con observación" description="Motivo: monto incompleto." />
        {confirming ? (
          <InlineConfirm
            title="¿Qué hay que corregir?"
            description="La representante verá este motivo al consultar su código."
            confirmLabel="Marcar con observación"
            onConfirm={() => setConfirming(false)}
            onCancel={() => setConfirming(false)}
            autoFocus={false}
          >
            <div className={cx(styles.row, styles.wrap)}>
              {["Monto incompleto", "Comprobante ilegible", "Transacción repetida"].map((r) => (
                <Chip key={r} variant="strong" size="sm" onClick={() => setReason(r)} selected={reason === r} selectedTone="bad">
                  {r}
                </Chip>
              ))}
            </div>
          </InlineConfirm>
        ) : (
          <Button variant="danger-soft" onClick={() => setConfirming(true)}>Marcar con observación</Button>
        )}
        <Card gap={14}>
          <CheckItem tone="ok" title="El monto coincide" detail="Esperado $14,00 · recibido $14,00" />
          <CheckItem tone="warn" title="Concepto abreviado" detail="Dice «Mateo A.»: confirma que es el mismo estudiante" />
          <CheckItem tone="bad" title="Nº de transacción repetido" detail="Aparece también en el pago NAV-018" />
        </Card>
      </Block>

      <Block title="Comprobante">
        <FileDrop label="Comprobante de pago" value={file} onChange={setFile} />
        <FileDrop label="Comprobante en PDF" value={pdf} onChange={setPdf} />
        <FileDrop label="Comprobante" value={empty} onChange={setEmpty} />
        <FileDrop label="Comprobante con error" value={null} onChange={() => undefined} error="No pudimos leer la imagen. Toma una captura de pantalla del comprobante." />
      </Block>

      <Block title="Hoja inferior">
        <div className={styles.sheetFrame}>
          <SheetLayout eyebrow="Viernes 18 de diciembre" title="Musical de Navidad 2026">
            <Sheet title="Sube tu comprobante" subtitle={<Chip variant="soft" size="sm" dot>Musical · $14,00</Chip>} closeHref="#" closeLabel="Cerrar y volver al evento" footer={<Button size="lg" fullWidth iconEnd="arrow-right">Enviar comprobante</Button>}>
              <TextField label="Representante" defaultValue="Carolina Vásquez" autoComplete="name" />
              <InfoNote icon="mail">Te avisamos cuando revisemos el pago.</InfoNote>
            </Sheet>
          </SheetLayout>
        </div>
      </Block>

      <Block title="Barras">
        <div className={styles.tabFrame}>
          <TabBar
            label="Secciones de tesorería"
            placement="bottom"
            activeKey={tab}
            onSelect={setTab}
            items={[
              { key: "resumen", label: "Resumen", icon: "home", href: "#resumen" },
              { key: "pagos", label: "Pagos", icon: "receipt", href: "#pagos", badge: 7, badgeLabel: "7 por revisar" },
              { key: "eventos", label: "Eventos", icon: "calendar", href: "#eventos" },
              { key: "ajustes", label: "Ajustes", icon: "settings", href: "#ajustes" },
            ]}
          />
        </div>
        <TabBar
          label="Secciones (escritorio)"
          placement="top"
          activeKey={tab}
          onSelect={setTab}
          items={[
            { key: "resumen", label: "Resumen", icon: "home", href: "#resumen" },
            { key: "pagos", label: "Pagos", icon: "receipt", href: "#pagos", badge: 7 },
            { key: "eventos", label: "Eventos", icon: "calendar", href: "#eventos" },
          ]}
        />
        <ActionBar summaryLabel="Tu aporte" summaryValue={<Money cents={1400} />}>
          <Button iconStart="upload">Ya pagué · Subir</Button>
        </ActionBar>
        <ActionBar>
          <Button variant="danger-soft" iconStart="x">Rechazar</Button>
          <Button variant="ok" iconStart="check">Confirmar pago</Button>
        </ActionBar>
      </Block>

      <Block title="Vacío, carga y avisos">
        <EmptyState icon="search" title="No hay pagos con estos filtros" description="Cambia el estado o el evento para ver más." action={<Button variant="glass" size="sm">Quitar filtros</Button>} />
        <Card gap={12}>
          <Row wrap={false}>
            <Skeleton width={42} height={42} radius="circle" />
            <Skeleton lines={2} />
          </Row>
          <Skeleton height={8} radius="pill" />
        </Card>
        <Row>
          <Button variant="glass" size="sm" onClick={() => toast.show({ message: "Copiado al portapapeles", tone: "ok" })}>Aviso correcto</Button>
          <Button variant="glass" size="sm" onClick={() => toast.show({ message: "No pudimos conectarnos. Revisa tu conexión.", tone: "error" })}>Aviso de error</Button>
          <Button variant="glass" size="sm" onClick={() => toast.show("Guardado")}>Aviso neutro</Button>
        </Row>
      </Block>
    </div>
  );
}
