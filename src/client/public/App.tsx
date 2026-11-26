import { matchPath, useRoute } from "../lib/router";
import { ToastProvider } from "../ui";
import { LoadingPage } from "./components/LoadingPage";
import { NetworkErrorPage, NotFoundPage } from "./components/StateMessage";
import { Analytics } from "./components/Analytics";
import { CollectionPage } from "./features/collection/CollectionPage";
import { HomePage } from "./features/home/HomePage";
import { ConfigProvider, useCollection, useCollections } from "./hooks/data";

/** Slugs as the worker accepts them (also guards the old `/r/...` links). */
export const SLUG_RE = /^[a-z0-9-]{3,48}$/;

/** Public app: collections home, collection page (pay, status, progress) and not-found. */
export function App() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <Routes />
        <Analytics />
      </ToastProvider>
    </ConfigProvider>
  );
}

function Routes() {
  const route = useRoute();
  const collections = useCollections();
  const count = collections.data ? collections.data.collections.length : null;

  if (route.path === "/") {
    if (!collections.data) {
      if (collections.error) return <NetworkErrorPage onRetry={collections.reload} retrying={collections.loading} />;
      return <LoadingPage />;
    }
    const open = collections.data.collections.filter((c) => c.status === "abierta");
    const [only] = open;
    // A single open collection opens in place (the URL stays "/"); "?todas" always shows the list.
    if (open.length === 1 && only && !route.query.has("todas")) {
      return <CollectionRoute key={only.slug} slug={only.slug} collectionsCount={count} />;
    }
    return <HomePage collections={collections.data.collections} />;
  }

  const params = matchPath("/r/:slug", route.path);
  if (params && SLUG_RE.test(params.slug)) {
    return <CollectionRoute key={params.slug} slug={params.slug} collectionsCount={count} />;
  }
  return <NotFoundPage />;
}

function CollectionRoute({ slug, collectionsCount }: { slug: string; collectionsCount: number | null }) {
  const collection = useCollection(slug);
  if (collection.data) return <CollectionPage collection={collection.data} collectionsCount={collectionsCount} />;
  if (collection.error) {
    if (collection.errorStatus === 404) return <NotFoundPage collection />;
    return <NetworkErrorPage onRetry={collection.reload} retrying={collection.loading} />;
  }
  return <LoadingPage collection />;
}
