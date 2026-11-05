import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  version: text("version").notNull(),
  filename: text("filename").notNull(),
  byteSize: integer("byte_size").notNull(),
  pageCount: integer("page_count").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("documents_owner_idx").on(table.ownerId)]);

export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  page: integer("page").notNull(),
  section: text("section").notNull(),
  text: text("text").notNull(),
}, (table) => [index("chunks_document_idx").on(table.documentId), index("chunks_owner_idx").on(table.ownerId)]);
