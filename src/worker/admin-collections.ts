import type {
  AdminCollection,
  AdminCollectionStats,
  AdminCollectionMutationResponse,
  AdminCollectionsResponse,
  PaymentStatus,
} from "../shared/api";
import { DEFAULT_MAX_PER_PAYMENT, DEFAULT_TONE, MAX_COLLECTION_JSON_BYTES } from "./constants";
import { parseNotes, parseOptions } from "./collections";
import { coverUrl } from "./covers";
import { HttpError, json, readJson } from "./http";
import type { CollectionRow } from "./rows";
import { parseCollectionFields, type CollectionFields } from "./validation";

function emptyStats(): AdminCollectionStats {
  return { payments: 0, students: 0, enRevision: 0, recibido: 0, observado: 0, pagado: 0, paidCents: 0, expectedCents: 0 };
}

export function adminCollectionView(row: CollectionRow, stats: AdminCollectionStats): AdminCollection {
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
    coverUrl: coverUrl(row.cover_key),
    deunaLink: row.deuna_link,
    deunaLinkExpires: row.deuna_link_expires,
    stats,
  };
}

/** Per-collection stats, optionally for a single collection. Void payments are excluded everywhere. */
async function loadStats(env: Env, collectionId: string | null): Promise<Map<string, AdminCollectionStats>> {
  const filter = collectionId ? "AND p.collection_id = ?" : "";
  const bindings = collectionId ? [collectionId] : [];
  const { results: paymentStats } = await env.DB.prepare(
    `SELECT p.collection_id, p.status, count(*) AS n, sum(p.amount_cents) AS amount, sum(p.expected_cents) AS expected
       FROM payments p WHERE p.status != 'anulado' ${filter} GROUP BY p.collection_id, p.status`,
  )
    .bind(...bindings)
    .all<{ collection_id: string; status: PaymentStatus; n: number; amount: number; expected: number }>();
  const { results: studentStats } = await env.DB.prepare(
    `SELECT p.collection_id, p.status, count(*) AS n
       FROM students s JOIN payments p ON p.id = s.payment_id
      WHERE p.status != 'anulado' ${filter} GROUP BY p.collection_id, p.status`,
  )
    .bind(...bindings)
    .all<{ collection_id: string; status: PaymentStatus; n: number }>();

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

export async function getAdminCollection(env: Env, id: string): Promise<AdminCollection> {
  const row = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(id).first<CollectionRow>();
  if (!row) throw new HttpError(404, "collection_not_found", "No encontramos esta recaudación.");
  const stats = await loadStats(env, id);
  return adminCollectionView(row, stats.get(id) ?? emptyStats());
}

export async function mutationResponse(env: Env, id: string, status = 200): Promise<Response> {
  return json({ ok: true, collection: await getAdminCollection(env, id) } satisfies AdminCollectionMutationResponse, status);
}

export async function adminListCollections(env: Env): Promise<Response> {
  const { results: rows } = await env.DB.prepare("SELECT * FROM collections ORDER BY created_at DESC").all<CollectionRow>();
  const stats = await loadStats(env, null);
  return json({ collections: rows.map((row) => adminCollectionView(row, stats.get(row.id) ?? emptyStats())) } satisfies AdminCollectionsResponse);
}

function slugTaken(): HttpError {
  return new HttpError(409, "slug_taken", "Ya existe una recaudación con ese enlace. Elige otro.");
}

async function assertSlugFree(env: Env, slug: string, exceptId: string | null): Promise<void> {
  const taken = await env.DB.prepare("SELECT 1 FROM collections WHERE slug = ? AND id != ?")
    .bind(slug, exceptId ?? "")
    .first();
  if (taken) throw slugTaken();
}

export async function createCollection(request: Request, env: Env): Promise<Response> {
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
    tone: parsed.tone ?? DEFAULT_TONE,
    deunaLink: parsed.deunaLink ?? null,
    deunaLinkExpires: parsed.deunaLink ? (parsed.deunaLinkExpires ?? null) : null,
  };
  await assertSlugFree(env, fields.slug, null);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO collections (id, slug, title, eyebrow, description, notes_json, options_json, deadline, status, max_per_payment, tone, deuna_link, deuna_link_expires, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return mutationResponse(env, id, 201);
}

export async function updateCollection(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson(request, MAX_COLLECTION_JSON_BYTES);
  const existing = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(id).first<CollectionRow>();
  if (!existing) throw new HttpError(404, "collection_not_found", "No encontramos esta recaudación.");

  const changes = parseCollectionFields(body, false);
  if (changes.slug !== undefined) await assertSlugFree(env, changes.slug, id);

  if (changes.options) {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT s.option_key FROM students s JOIN payments p ON p.id = s.payment_id WHERE p.collection_id = ?`,
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
    await env.DB.prepare(
      `UPDATE collections SET slug = ?, title = ?, eyebrow = ?, description = ?, notes_json = ?, options_json = ?,
              deadline = ?, status = ?, max_per_payment = ?, tone = ?, deuna_link = ?, deuna_link_expires = ?, updated_at = ? WHERE id = ?`,
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
  return mutationResponse(env, id);
}
