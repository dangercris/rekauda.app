import type {
  AdminCollection,
  AdminCollectionStats,
  AdminCollectionMutationResponse,
  AdminCollectionsResponse,
  PaymentStatus,
} from "../shared/api";
import { DEFAULT_MAX_PER_PAYMENT, MAX_COLLECTION_JSON_BYTES } from "./constants";
import { parseNotes, parseOptions } from "./collections";
import type { RequestContext } from "./context";
import type { TenantDb } from "./data/tenant-db";
import { coverUrl } from "./covers";
import { HttpError, json, readJson } from "./http";
import type { CollectionRow } from "./rows";
import { parseCollectionFields, type CollectionFields } from "./validation";

function emptyStats(): AdminCollectionStats {
  return { payments: 0, students: 0, enRevision: 0, recibido: 0, observado: 0, pagado: 0, paidCents: 0, expectedCents: 0 };
}

export function adminCollectionView(row: CollectionRow, stats: AdminCollectionStats, r2Prefix: string): AdminCollection {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    eyebrow: row.eyebrow,
    description: row.description,
    notes: parseNotes(row.notes_json),
    deadline: row.deadline,
    status: row.status,
    maxPerPayment: row.max_per_payment,
    options: parseOptions(row.options_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tone: row.tone,
    coverUrl: coverUrl(row.cover_key, r2Prefix),
    deunaLink: row.deuna_link,
    deunaLinkExpires: row.deuna_link_expires,
    stats,
  };
}

/** Per-collection stats, optionally for a single collection. Void payments are excluded everywhere. */
async function loadStats(db: TenantDb, collectionId: string | null): Promise<Map<string, AdminCollectionStats>> {
  // Two fixed statements: ?2 is the collection id when filtering. A NULL filter would not be a plain tenant predicate.
  const paymentSql = `SELECT p.collection_id, p.status, count(*) AS n, sum(p.amount_cents) AS amount, sum(p.expected_cents) AS expected
       FROM payments p WHERE p.tenant_id = ?1 AND p.status != 'anulado'`;
  const studentSql = `SELECT p.collection_id, p.status, count(*) AS n
       FROM students s JOIN payments p ON p.id = s.payment_id AND p.tenant_id = ?1
      WHERE s.tenant_id = ?1 AND p.status != 'anulado'`;
  const group = "GROUP BY p.collection_id, p.status";
  const { results: paymentStats } = await (collectionId
    ? db.prepare(`${paymentSql} AND p.collection_id = ?2 ${group}`).bind(collectionId)
    : db.prepare(`${paymentSql} ${group}`).bind()
  ).all<{ collection_id: string; status: PaymentStatus; n: number; amount: number; expected: number }>();
  const { results: studentStats } = await (collectionId
    ? db.prepare(`${studentSql} AND p.collection_id = ?2 ${group}`).bind(collectionId)
    : db.prepare(`${studentSql} ${group}`).bind()
  ).all<{ collection_id: string; status: PaymentStatus; n: number }>();

  const stats = new Map<string, AdminCollectionStats>();
  const statsOf = (id: string) => {
    const current = stats.get(id) ?? emptyStats();
    stats.set(id, current);
    return current;
  };
  for (const r of paymentStats) {
    const s = statsOf(r.collection_id);
    s.payments += r.n;
    s.expectedCents += r.expected;
    if (r.status === "pagado") s.paidCents += r.amount;
  }
  for (const r of studentStats) {
    const s = statsOf(r.collection_id);
    s.students += r.n;
    if (r.status === "en_revision") s.enRevision += r.n;
    else if (r.status === "recibido") s.recibido += r.n;
    else if (r.status === "observado") s.observado += r.n;
    else if (r.status === "pagado") s.pagado += r.n;
  }
  return stats;
}

export async function getAdminCollection({ db, tenant }: RequestContext, id: string): Promise<AdminCollection> {
  const row = await db.prepare("SELECT * FROM collections WHERE tenant_id = ?1 AND id = ?2").bind(id).first<CollectionRow>();
  if (!row) throw new HttpError(404, "collection_not_found", "No encontramos esta recaudación.");
  const stats = await loadStats(db, id);
  return adminCollectionView(row, stats.get(id) ?? emptyStats(), tenant.r2Prefix);
}

export async function mutationResponse(rc: RequestContext, id: string, status = 200): Promise<Response> {
  return json({ ok: true, collection: await getAdminCollection(rc, id) } satisfies AdminCollectionMutationResponse, status);
}

export async function adminListCollections({ db, tenant }: RequestContext): Promise<Response> {
  const { results: rows } = await db.prepare("SELECT * FROM collections WHERE tenant_id = ?1 ORDER BY created_at DESC").bind().all<CollectionRow>();
  const stats = await loadStats(db, null);
  return json({
    collections: rows.map((row) => adminCollectionView(row, stats.get(row.id) ?? emptyStats(), tenant.r2Prefix)),
  } satisfies AdminCollectionsResponse);
}

function slugTaken(): HttpError {
  return new HttpError(409, "slug_taken", "Ya existe una recaudación con ese enlace. Elige otro.");
}

async function assertSlugFree(db: TenantDb, slug: string, exceptId: string | null): Promise<void> {
  const taken = await db
    .prepare("SELECT 1 FROM collections WHERE tenant_id = ?1 AND slug = ?2 AND id != ?3")
    .bind(slug, exceptId ?? "")
    .first();
  if (taken) throw slugTaken();
}

export async function createCollection(request: Request, rc: RequestContext): Promise<Response> {
  const { db } = rc;
  const body = await readJson(request, MAX_COLLECTION_JSON_BYTES);
  const parsed = parseCollectionFields(body, true);
  const fields: CollectionFields = {
    slug: parsed.slug as string,
    title: parsed.title as string,
    eyebrow: parsed.eyebrow ?? null,
    description: parsed.description as string,
    notes: parsed.notes ?? [],
    options: parsed.options as CollectionFields["options"],
    deadline: parsed.deadline as string,
    status: parsed.status ?? "abierta",
    maxPerPayment: parsed.maxPerPayment ?? DEFAULT_MAX_PER_PAYMENT,
    tone: parsed.tone ?? rc.config.defaultTone,
    deunaLink: parsed.deunaLink ?? null,
    deunaLinkExpires: parsed.deunaLink ? (parsed.deunaLinkExpires ?? null) : null,
  };
  await assertSlugFree(db, fields.slug, null);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO collections (tenant_id, id, slug, title, eyebrow, description, notes_json, options_json, deadline, status, max_per_payment, tone, deuna_link, deuna_link_expires, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
      )
      .bind(
        id,
        fields.slug,
        fields.title,
        fields.eyebrow,
        fields.description,
        JSON.stringify(fields.notes),
        JSON.stringify(fields.options),
        fields.deadline,
        fields.status,
        fields.maxPerPayment,
        fields.tone,
        fields.deunaLink,
        fields.deunaLinkExpires,
        now,
        now,
      )
      .run();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw slugTaken();
    throw e;
  }

  console.log(JSON.stringify({ message: "collection created", id, slug: fields.slug }));
  return mutationResponse(rc, id, 201);
}

export async function updateCollection(request: Request, rc: RequestContext, id: string): Promise<Response> {
  const { db } = rc;
  const body = await readJson(request, MAX_COLLECTION_JSON_BYTES);
  const existing = await db.prepare("SELECT * FROM collections WHERE tenant_id = ?1 AND id = ?2").bind(id).first<CollectionRow>();
  if (!existing) throw new HttpError(404, "collection_not_found", "No encontramos esta recaudación.");

  const changes = parseCollectionFields(body, false);
  if (changes.slug !== undefined) await assertSlugFree(db, changes.slug, id);

  if (changes.options) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT s.option_key FROM students s JOIN payments p ON p.id = s.payment_id AND p.tenant_id = ?1
          WHERE s.tenant_id = ?1 AND p.collection_id = ?2`,
      )
      .bind(id)
      .all<{ option_key: string }>();
    const kept = new Set(changes.options.map((o) => o.key));
    const removed = results.find((r) => !kept.has(r.option_key));
    if (removed) {
      throw new HttpError(409, "option_in_use", `La opción "${removed.option_key}" ya tiene estudiantes registrados y no se puede quitar.`);
    }
  }

  const deunaLink = changes.deunaLink !== undefined ? changes.deunaLink : existing.deuna_link;
  const merged = {
    deunaLink,
    deunaLinkExpires: deunaLink === null ? null : changes.deunaLinkExpires !== undefined ? changes.deunaLinkExpires : existing.deuna_link_expires,
    slug: changes.slug ?? existing.slug,
    title: changes.title ?? existing.title,
    eyebrow: changes.eyebrow !== undefined ? changes.eyebrow : existing.eyebrow,
    description: changes.description ?? existing.description,
    notesJson: changes.notes ? JSON.stringify(changes.notes) : existing.notes_json,
    optionsJson: changes.options ? JSON.stringify(changes.options) : existing.options_json,
    deadline: changes.deadline ?? existing.deadline,
    status: changes.status ?? existing.status,
    maxPerPayment: changes.maxPerPayment ?? existing.max_per_payment,
    tone: changes.tone ?? existing.tone,
  };
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `UPDATE collections SET slug = ?2, title = ?3, eyebrow = ?4, description = ?5, notes_json = ?6, options_json = ?7,
                deadline = ?8, status = ?9, max_per_payment = ?10, tone = ?11, deuna_link = ?12, deuna_link_expires = ?13, updated_at = ?14
          WHERE tenant_id = ?1 AND id = ?15`,
      )
      .bind(
        merged.slug,
        merged.title,
        merged.eyebrow,
        merged.description,
        merged.notesJson,
        merged.optionsJson,
        merged.deadline,
        merged.status,
        merged.maxPerPayment,
        merged.tone,
        merged.deunaLink,
        merged.deunaLinkExpires,
        now,
        id,
      )
      .run();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw slugTaken();
    throw e;
  }

  console.log(JSON.stringify({ message: "collection updated", id, status: merged.status }));
  return mutationResponse(rc, id);
}
