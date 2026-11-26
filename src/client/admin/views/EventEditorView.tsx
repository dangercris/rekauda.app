import { Button, Card, EmptyState, Skeleton, TopBar } from "../../ui";
import { ErrorState } from "../components/common";
import { useAdminData } from "../data/AdminData";
import { EventEditor } from "../editor/EventEditor";

/** `#evento/nuevo` and `#evento/<id>`: waits for the collections, then mounts the editor with its data. */
export function EventEditorView({ collectionId }: { collectionId: string | null }) {
  const { collections } = useAdminData();

  if (collectionId === null) return <EventEditor collection={null} />;

  if (collections.status === "loading") {
    return (
      <>
        <TopBar title="Editar evento" backHref="#eventos" backIcon="x" backLabel="Cerrar" />
        <div role="status" aria-label="Cargando la recaudación">
          <Skeleton height={260} radius={34} />
        </div>
        <Card radius="2xl" padding="lg" gap={12}>
          <Skeleton lines={5} />
        </Card>
      </>
    );
  }
  if (collections.status === "error") {
    return (
      <>
        <TopBar title="Editar evento" backHref="#eventos" backIcon="x" backLabel="Cerrar" />
        <ErrorState message={collections.error ?? ""} onRetry={() => void collections.reload()} retrying={collections.refreshing} />
      </>
    );
  }
  const collection = collections.collections.find((c) => c.id === collectionId);
  if (!collection) {
    return (
      <>
        <TopBar title="Editar evento" backHref="#eventos" backIcon="x" backLabel="Cerrar" />
        <EmptyState
          icon="search"
          title="No encontramos esta recaudación"
          description="Puede que el enlace esté incompleto."
          action={
            <Button href="#eventos" variant="glass" size="sm" iconStart="arrow-left">
              Ver eventos
            </Button>
          }
        />
      </>
    );
  }
  return <EventEditor collection={collection} />;
}
