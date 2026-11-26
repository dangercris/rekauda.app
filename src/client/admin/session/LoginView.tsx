import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorMessage, isApiRequestError } from "../../lib/api";
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
        (auth.mode === "magic_link" ? <MagicLinkPlaceholder notice={state.notice} /> : <LoginForm onLogin={session.login} notice={state.notice} />)}
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

/** Cloud accounts sign in with an emailed link, which is not available yet: no form, so nobody types a password here. */
function MagicLinkPlaceholder({ notice }: { notice: string | null }) {
  return (
    <Card className={styles.card} gap={16}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Ingreso con tu correo</h1>
        <p className={styles.lead}>Pronto podrás ingresar con tu correo. Mientras tanto, esta página aún no permite el acceso.</p>
      </div>
      {notice && <Notice tone="warn" icon="clock" title={notice} live />}
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
