CREATE TRIGGER documents_count_quota BEFORE INSERT ON documents
WHEN (SELECT count(*) FROM documents WHERE owner_id = NEW.owner_id) >= 30
BEGIN
  SELECT RAISE(ABORT, 'folio_document_quota');
END;
--> statement-breakpoint
CREATE TRIGGER documents_chunks_quota BEFORE INSERT ON documents
WHEN NEW.chunk_count > 600 OR (SELECT coalesce(sum(chunk_count), 0) FROM documents WHERE owner_id = NEW.owner_id) + NEW.chunk_count > 4000
BEGIN
  SELECT RAISE(ABORT, 'folio_chunk_quota');
END;
