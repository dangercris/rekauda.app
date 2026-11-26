import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorMessage, isApiRequestError, requestMagicLink } from "../../lib/api";
import { useInstanceConfig } from "../../lib/config/useInstance";
import { BrandPill, Button, Card, InfoNote, Notice, Spinner, TextField, Toggle } from "../../ui";
import type { SessionApi } from "./useSession";
import styles from "./LoginView.module.css";

/** Everything that is not the signed-in panel: checking, login form, setup notice, session check failure. */
export function SessionGate({ session }: { session: SessionApi }) {
  const { state } = session;
  const { classMark, classShortName, auth } = useInstanceConfig();
  return (
    <main className={styles.page}>
      <BrandPill mark={classMark} title="Tesorería" subtitle={classShortName} className={styles.brand} />
      {state.status === "checking" && (
        <div className={styles.center}>
          <Spinner size={26} label="Verificando la sesión" />
        </div>
      )}
      {state.status === "signedOut" &&
        (auth.mode === "magic_link" ? <MagicLinkForm notice={state.notice} /> : <LoginForm onLogin={session.login} notice={state.notice} />)}
      {state.status === "confirmLink" && <LinkConfirm onConfirm={session.confirmLink} />}
      {state.status === "disabled" && <SetupNotice message={state.message} onRetry={session.retry} />}
      {state.status === "error" && (
        <Card className={styles.card} gap={16}>
          <Notice tone="bad" icon="alert-circle" title="No pudimos verificar tu sesión" description={state.message} live />
          <Button variant="ink" iconStart="refresh" onClick={session.retry}>
            Reintentar
          </Button>
        </Card>
      )}
    </main>
  );
}

/**
 * Cloud accounts sign in with an emailed link. The confirmation is the same for every address on purpose: it never says
 * whether the address belongs to someone. Opening the link is handled by useSession (linkLogin.ts), not here.
 */
function MagicLinkForm({ notice }: { notice: string | null }) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === "sending") return;
    if (!email.trim()) {
      setError("Escribe tu correo.");
      inputRef.current?.focus();
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      await requestMagicLink(email.trim());
      setPhase("sent");
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("idle");
    }
  };

  if (phase === "sent") {
    return (
      <Card className={styles.card} gap={16}>
        <Notice tone="ok" icon="mail" title="Revisa tu correo" description="Si el correo está registrado, te enviamos un enlace para ingresar. Vence en 15 minutos y solo se puede usar una vez." live />
        <Button variant="glass" iconStart="refresh" onClick={() => setPhase("idle")}>
          Usar otro correo
        </Button>
      </Card>
    );
  }

  return (
    <form className={styles.card} onSubmit={submit} noValidate aria-labelledby="login-title">
      <Card gap={16}>
        <div className={styles.heading}>
          <h1 id="login-title" className={styles.title}>
            Ingreso con tu correo
          </h1>
          <p className={styles.lead}>Te enviamos un enlace para ingresar, sin contraseña.</p>
        </div>
        {notice && <Notice tone="warn" icon="clock" title={notice} live />}
        <TextField
          ref={inputRef}
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(null);
          }}
          error={error ?? undefined}
          disabled={phase === "sending"}
        />
        <Button type="submit" variant="ink" size="lg" fullWidth loading={phase === "sending"} iconEnd={phase === "sending" ? undefined : "arrow-right"}>
          Enviar enlace
        </Button>
        <InfoNote icon="shield">El enlace funciona una sola vez. Los comprobantes y teléfonos solo se ven aquí.</InfoNote>
      </Card>
    </form>
  );
}

/** Opening an emailed link only offers the sign-in: a click is required, so a link someone else sent cannot sign you in silently. */
function LinkConfirm({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const { className, classShortName } = useInstanceConfig();
  return (
    <Card className={styles.card} gap={16}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Confirma tu ingreso</h1>
        <p className={styles.lead}>Abriste un enlace de acceso a la tesorería de {className}.</p>
      </div>
      <Button variant="ink" size="lg" fullWidth iconEnd="arrow-right" onClick={() => void onConfirm()}>
        Ingresar a {classShortName}
      </Button>
      <InfoNote icon="shield">Si no pediste este enlace, cierra esta página.</InfoNote>
    </Card>
  );
}

function SetupNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className={styles.card} gap={16}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Falta configurar el acceso</h1>
        <p className={styles.lead}>{message}</p>
      </div>
      <InfoNote icon="settings">
        Quien administra el sitio debe definir el secreto <code className={styles.code}>ADMIN_PASSWORD</code> del Worker (por ejemplo con{" "}
        <code className={styles.code}>wrangler secret put</code>) y volver a cargar esta página.
      </InfoNote>
      <Button variant="glass" iconStart="refresh" onClick={onRetry}>
        Volver a comprobar
      </Button>
    </Card>
  );
}

function LoginForm({ onLogin, notice }: { onLogin: (password: string) => Promise<void>; notice: string | null }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!password) {
      setError("Escribe la contraseña.");
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    setRateLimited(false);
    try {
      await onLogin(password);
    } catch (caught) {
      setRateLimited(isApiRequestError(caught) && caught.status === 429);
      setError(errorMessage(caught));
      setLoading(false);
      inputRef.current?.select();
    }
  };

  return (
    <form className={styles.card} onSubmit={submit} noValidate aria-labelledby="login-title">
      <Card gap={16}>
        <div className={styles.heading}>
          <h1 id="login-title" className={styles.title}>
            Ingresar
          </h1>
          <p className={styles.lead}>Acceso solo para la tesorería del curso.</p>
        </div>
        {notice && <Notice tone="warn" icon="clock" title={notice} live />}
        <TextField
          ref={inputRef}
          label="Contraseña"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error && !rateLimited) setError(null);
          }}
          error={error ?? undefined}
          disabled={loading}
        />
        <Toggle label="Mostrar contraseña" checked={visible} onChange={setVisible} tone="event" disabled={loading} />
        <Button type="submit" variant="ink" size="lg" fullWidth loading={loading} iconEnd={loading ? undefined : "arrow-right"}>
          Ingresar
        </Button>
        <InfoNote icon="shield">
          La sesión dura 7 días en este dispositivo. Los comprobantes y teléfonos solo se ven aquí.
        </InfoNote>
      </Card>
    </form>
  );
}
