import { env } from "cloudflare:workers";
import { HttpError, object, text } from "./api";
import { chunkDocument } from "./rag";
import type { Chunk, DocumentInput, DocumentSummary } from "./types";

export function database() {
  if (!env.DB) throw new HttpError(503, "Document storage is not configured. See the setup instructions.");
  return env.DB;
}

export function validateDocument(value: unknown): DocumentInput {
  const body = object(value);
  const filename = text(body.filename, "Filename", 180);
  if (!/\.(txt|md|pdf)$/i.test(filename)) throw new HttpError(400, "Upload a PDF, Markdown, or text file.");
  const title = text(body.title, "Title", 120);
  const version = text(body.version, "Version", 40);
  if (typeof body.byteSize !== "number" || !Number.isInteger(body.byteSize) || body.byteSize < 1 || body.byteSize > 5_000_000) throw new HttpError(400, "Files must be smaller than 5 MB.");
  if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > 100) throw new HttpError(400, "Documents must contain 1–100 pages.");
  let characters = 0;
  const pages = body.pages.map((value, i) => {
    const page = object(value);
    if (page.page !== i + 1 || typeof page.text !== "string") throw new HttpError(400, "Document pages must be in order, starting at page 1.");
    characters += page.text.length;
    return { page: i + 1, text: page.text.replace(/\u0000/g, "") };
  });
  if (characters > 300_000) throw new HttpError(413, "Limit each document to 300,000 extracted characters.");
  if (!pages.some((page) => page.text.trim().length > 0)) throw new HttpError(400, "No readable text was found. Scanned PDFs need OCR before upload.");
  return { filename, title, version, byteSize: body.byteSize, pages };
}

const documentColumns = `id, title, version, filename, byte_size AS byteSize, page_count AS pageCount, chunk_count AS chunkCount, created_at AS createdAt`;

export async function listDocuments(ownerId: string): Promise<DocumentSummary[]> {
  const result = await database().prepare(`SELECT ${documentColumns} FROM documents WHERE owner_id = ? ORDER BY created_at DESC, id ASC`).bind(ownerId).all<DocumentSummary>();
  return result.results;
}

export async function saveDocument(ownerId: string, input: DocumentInput, stableId?: string): Promise<DocumentSummary> {
  return (await saveDocuments(ownerId, [{ input, stableId }]))[0];
}

/** One atomic batch makes sample import all-or-nothing; SQL triggers enforce quotas under concurrency. */
export async function saveDocuments(ownerId: string, items: { input: DocumentInput; stableId?: string }[]): Promise<DocumentSummary[]> {
  const db = database();
  const existing = await listDocuments(ownerId);
  const found = new Map(existing.map((document) => [document.id, document]));
  const pending = items.filter((item) => !item.stableId || !found.has(item.stableId));
  const usage = await db.prepare("SELECT count(*) AS count, coalesce(sum(chunk_count), 0) AS chunks FROM documents WHERE owner_id = ?").bind(ownerId).first<{ count: number; chunks: number }>();
  if ((usage?.count ?? 0) + pending.length > 30) throw new HttpError(400, "Your starter library holds 30 documents. Delete documents before adding this collection.");
  let totalChunks = usage?.chunks ?? 0;
  const statements: D1PreparedStatement[] = [];
  const created: DocumentSummary[] = [];
  for (const { input, stableId } of pending) {
    const id = stableId ?? crypto.randomUUID();
    const chunks = chunkDocument(id, input);
    if (!chunks.length) throw new HttpError(400, "No indexable text was found.");
    totalChunks += chunks.length;
    if (chunks.length > 600 || totalChunks > 4000) throw new HttpError(400, "The library is full. Delete documents or upload a shorter file.");
    const createdAt = new Date().toISOString();
    const doc: DocumentSummary = { id, title: input.title, version: input.version, filename: input.filename, byteSize: input.byteSize, pageCount: input.pages.length, chunkCount: chunks.length, createdAt };
    created.push(doc);
    statements.push(db.prepare("INSERT INTO documents (id, owner_id, title, version, filename, byte_size, page_count, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, ownerId, doc.title, doc.version, doc.filename, doc.byteSize, doc.pageCount, doc.chunkCount, createdAt));
    for (const [ordinal, chunk] of chunks.entries()) statements.push(db.prepare("INSERT INTO chunks (id, document_id, owner_id, ordinal, page, section, text) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(chunk.id, id, ownerId, ordinal, chunk.page, chunk.section, chunk.text));
  }
  if (statements.length) {
    try { await db.batch(statements); }
    catch (error) {
      const description = error instanceof Error ? error.message : "";
      if (/folio_.*_quota/.test(description)) throw new HttpError(400, "The library is full. Delete documents before adding more.");
      // A competing sample import may have completed after our initial read.
      if (items.every((item) => item.stableId)) {
        const refreshed = await listDocuments(ownerId);
        const complete = items.map((item) => refreshed.find((document) => document.id === item.stableId));
        if (complete.every((document) => document !== undefined)) return complete as DocumentSummary[];
      }
      throw error;
    }
  }
  for (const document of created) found.set(document.id, document);
  const existingIds = new Set(existing.map((document) => document.id));
  let generatedIndex = 0;
  return items.map((item) => item.stableId && existingIds.has(item.stableId) ? found.get(item.stableId)! : created[generatedIndex++]);
}

export async function getChunks(ownerId: string, documentIds?: string[], version?: string): Promise<Chunk[]> {
  const params: string[] = [ownerId];
  let filter = "c.owner_id = ?";
  if (documentIds?.length) {
    filter += ` AND c.document_id IN (${documentIds.map(() => "?").join(",")})`;
    params.push(...documentIds);
  }
  if (version) { filter += " AND d.version = ?"; params.push(version); }
  const result = await database().prepare(`SELECT c.id, c.document_id AS documentId, d.title AS documentName, d.version, c.page, c.section, c.text FROM chunks c JOIN documents d ON c.document_id = d.id AND d.owner_id = c.owner_id WHERE ${filter} ORDER BY c.document_id, c.ordinal LIMIT 4000`).bind(...params).all<Chunk>();
  return result.results;
}

export async function removeDocument(ownerId: string, id: string) {
  const db = database();
  const existing = await db.prepare("SELECT id FROM documents WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
  if (!existing) throw new HttpError(404, "This document was not found.");
  await db.batch([db.prepare("DELETE FROM chunks WHERE document_id = ? AND owner_id = ?").bind(id, ownerId), db.prepare("DELETE FROM documents WHERE id = ? AND owner_id = ?").bind(id, ownerId)]);
}
