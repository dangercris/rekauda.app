/** Data hooks for the public app. Every request is aborted when its component unmounts. */
import type { BoardResponse, CollectionDetail, CollectionsResponse } from "../../../shared/api";
import { getBoard, getCollection, listCollections } from "../../lib/publicApi";
import { useResource, type Resource } from "./useResource";

export function useCollections(): Resource<CollectionsResponse> {
  return useResource((signal) => listCollections({ signal }), []);
}

export function useCollection(slug: string): Resource<CollectionDetail> {
  return useResource((signal) => getCollection(slug, { signal }), [slug]);
}

export function useBoard(slug: string): Resource<BoardResponse> {
  return useResource((signal) => getBoard(slug, { signal }), [slug]);
}
