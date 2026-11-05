import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(new URL("../drizzle/0000_minor_amazoness.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../drizzle/0001_library_quotas.sql", import.meta.url), "utf8"));
  return db;
}

function insert(db: DatabaseSync, id: string, owner = "alice", chunks = 1) {
  db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, owner, "Test guide", "v1", "guide.txt", 100, 1, chunks, "2026-01-01");
}

test("database enforces the document quota while allowing another owner's library", () => {
  const db = database();
  try {
    for (let i = 0; i < 30; i++) insert(db, `doc-${i}`);
    assert.throws(() => insert(db, "overflow"), /folio_document_quota/);
    insert(db, "bob-doc", "bob");
    assert.equal(db.prepare("SELECT count(*) AS count FROM documents WHERE owner_id='alice'").get()?.count, 30);
  } finally { db.close(); }
});

test("a failed multi-document transaction rolls back the complete sample import", () => {
  const db = database();
  try {
    for (let i = 0; i < 28; i++) insert(db, `doc-${i}`);
    db.exec("BEGIN");
    assert.throws(() => { for (let i = 0; i < 4; i++) insert(db, `sample-${i}`); }, /folio_document_quota/);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT count(*) AS count FROM documents").get()?.count, 28);
    assert.equal(db.prepare("SELECT count(*) AS count FROM documents WHERE id LIKE 'sample-%'").get()?.count, 0);
  } finally { db.close(); }
});

test("chunk quota rejects oversized libraries and deletion frees space", () => {
  const db = database();
  try {
    for (let i = 0; i < 6; i++) insert(db, `doc-${i}`, "alice", 600);
    insert(db, "last", "alice", 400);
    assert.throws(() => insert(db, "overflow"), /folio_chunk_quota/);
    db.prepare("DELETE FROM documents WHERE id=?").run("last");
    insert(db, "replacement", "alice", 400);
  } finally { db.close(); }
});
