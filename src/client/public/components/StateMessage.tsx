import { Button, EmptyState, type IconName } from "../../ui";
import { PageFrame } from "./PageFrame";

export interface StateMessageProps {
  title: string;
  description: string;
  icon?: IconName | undefined;
  /** Shows "Intentar de nuevo" (network errors); otherwise a link home. */
  onRetry?: (() => void) | undefined;
  retrying?: boolean | undefined;
}

/** Full-page message: not found, closed links, network errors with retry. */
export function StateMessage({ title, description, icon = "search", onRetry, retrying }: StateMessageProps) {
  return (
    <PageFrame>
      <EmptyState
        icon={icon}
        title={<span role={onRetry ? "alert" : undefined}>{title}</span>}
        description={description}
        action={
          onRetry ? (
            <Button variant="event" iconStart="refresh" onClick={onRetry} loading={retrying}>
              Intentar de nuevo
            </Button>
          ) : (
            <Button variant="glass" href="/" iconStart="arrow-left">
              Ver recaudaciones
            </Button>
          )
        }
      />
    </PageFrame>
  );
}

export function NotFoundPage({ collection }: { collection?: boolean | undefined }) {
  return (
    <StateMessage
      title={collection ? "No encontramos esta recaudación" : "Página no encontrada"}
      description="Revisa el link que te compartieron o vuelve al inicio."
    />
  );
}

export function NetworkErrorPage({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean | undefined }) {
  return (
    <StateMessage
      icon="alert-circle"
      title="No pudimos cargar la página"
      description="Revisa tu conexión a internet y vuelve a intentarlo."
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}
