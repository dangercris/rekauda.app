import type {
  BoardResponse,
  BoardStudent,
  BoardTotals,
  CollectionDetail,
  CollectionOption,
  CollectionSummary,
  CollectionsResponse,
  PaymentStatus,
} from "../shared/api";
import type { TenantDb } from "./data/tenant-db";
import type { RequestContext } from "./context";
import { coverUrl } from "./covers";
import { HttpError, json } from "./http";
import { isPublicRow, type CollectionRow, type PublicCollectionRow, type StudentStatusRow } from "./rows";
import { displayName, normalize } from "./validation";

export type DedupedStudent = { name: string; sortKey: string; option: string; status: PaymentStatus };

export const STATUS_RANK: Record<PaymentStatus, number> = {
  pagado: 4,
  recibido: 3,
  en_revision: 2,
  observado: 1,
  anulado: 0,
};

export function parseOptions(raw: string): CollectionOption[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CollectionOption[]) : [];
  } catch {
    return [];
  }
}

export function parseNotes(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/** Today in Ecuador (America/Guayaquil, no DST) as YYYY-MM-DD. */
export function todayGuayaquil(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The collection Deuna link families may use: null without a link or once the expiry day has passed (valid through that day). */
export function activeDeunaLink(row: Pick<CollectionRow, "deuna_link" | "deuna_link_expires">, now: Date = new Date()): string | null {
  if (!row.deuna_link) return null;
  if (row.deuna_link_expires && todayGuayaquil(now) > row.deuna_link_expires) return null;
  return row.deuna_link;
}

export function collectionDetailView(row: PublicCollectionRow, r2Prefix: string, now: Date = new Date()): CollectionDetail {
  return {
    slug: row.slug,
    title: row.title,
    eyebrow: row.eyebrow,
    description: row.description,
    notes: parseNotes(row.notes_json),
    deadline: row.deadline,
    status: row.status,
    maxPerPayment: row.max_per_payment,
    options: parseOptions(row.options_json),
    tone: row.tone,
    coverUrl: coverUrl(row.cover_key, r2Prefix),
    deunaLink: activeDeunaLink(row, now),
  };
}

/** Public lookup by slug: archived collections do not exist for the public. */
export async function findPublicCollection(db: TenantDb, slug: string): Promise<PublicCollectionRow> {
  const row = await db
    .prepare("SELECT * FROM collections WHERE tenant_id = ?1 AND slug = ?2 AND status != 'archivada'")
    .bind(slug)
    .first<CollectionRow>();
  if (!row || !isPublicRow(row)) throw new HttpError(404, "collection_not_found", "No encontramos esta recaudación.");
  return row;
}

/** A family may resubmit after an observation: keep the best status per student, per collection. */
export function dedupeStudents(rows: StudentStatusRow[]): Map<string, DedupedStudent[]> {
  const byCollection = new Map<string, Map<string, DedupedStudent>>();
  for (const row of rows) {
    const students = byCollection.get(row.collection_id) ?? new Map<string, DedupedStudent>();
    byCollection.set(row.collection_id, students);
    const key = normalize(`${row.given_names} ${row.surnames}`);
    const current = students.get(key);
    if (!current || STATUS_RANK[row.status] > STATUS_RANK[current.status]) {
      students.set(key, {
        name: displayName(row.given_names, row.surnames),
        sortKey: normalize(`${row.surnames} ${row.given_names}`),
        option: row.option_key,
        status: row.status,
      });
    }
  }
  return new Map([...byCollection].map(([id, students]) => [id, [...students.values()]]));
}

export async function listCollections({ db, tenant }: RequestContext): Promise<Response> {
  const { results: rows } = await db.prepare("SELECT * FROM collections WHERE tenant_id = ?1 AND status != 'archivada'").bind().all<CollectionRow>();
  const { results: studentRows } = await db
    .prepare(
      `SELECT p.collection_id, s.given_names, s.surnames, s.option_key, p.status
         FROM students s JOIN payments p ON p.id = s.payment_id AND p.tenant_id = ?1
        WHERE s.tenant_id = ?1 AND p.status != 'anulado'`,
    )
    .bind()
    .all<StudentStatusRow>();
  const deduped = dedupeStudents(studentRows);

  const collections = rows
    .filter(isPublicRow)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "abierta" ? -1 : 1;
      return a.status === "abierta" ? a.deadline.localeCompare(b.deadline) : b.deadline.localeCompare(a.deadline);
    })
    .map((row): CollectionSummary => {
      const students = deduped.get(row.id) ?? [];
      return {
        slug: row.slug,
        title: row.title,
        eyebrow: row.eyebrow,
        deadline: row.deadline,
        status: row.status,
        options: parseOptions(row.options_json),
        registered: students.length,
        paid: students.filter((s) => s.status === "pagado").length,
        tone: row.tone,
        coverUrl: coverUrl(row.cover_key, tenant.r2Prefix),
      };
    });
  return json({ collections } satisfies CollectionsResponse);
}

export async function collectionDetail({ db, tenant }: RequestContext, slug: string): Promise<Response> {
  return json(collectionDetailView(await findPublicCollection(db, slug), tenant.r2Prefix) satisfies CollectionDetail);
}

export async function collectionBoard({ db }: RequestContext, slug: string): Promise<Response> {
  const collection = await findPublicCollection(db, slug);
  const { results } = await db
    .prepare(
      `SELECT p.collection_id, s.given_names, s.surnames, s.option_key, p.status
         FROM students s JOIN payments p ON p.id = s.payment_id AND p.tenant_id = ?1
        WHERE s.tenant_id = ?1 AND p.collection_id = ?2 AND p.status != 'anulado'`,
    )
    .bind(collection.id)
    .all<StudentStatusRow>();

  const labels = new Map(parseOptions(collection.options_json).map((o) => [o.key, o.label]));
  const students: BoardStudent[] = [];
  const totals: BoardTotals = { registrados: 0, pagado: 0, recibido: 0, en_revision: 0, observado: 0 };
  const sorted = (dedupeStudents(results).get(collection.id) ?? []).sort((a, b) => a.sortKey.localeCompare(b.sortKey, "es"));
  for (const { name, option, status } of sorted) {
    // The query already excludes void payments; the guard keeps the types honest.
    if (status === "anulado") continue;
    students.push({ name, option, optionLabel: labels.get(option) ?? option, status });
    totals.registrados += 1;
    totals[status] += 1;
  }

  return json({ students, totals } satisfies BoardResponse);
}
