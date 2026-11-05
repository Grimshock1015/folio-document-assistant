import test from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, extractiveAnswer, searchChunks } from "../lib/rag.ts";
import { demoDocuments, runEvaluation } from "../lib/demo.ts";
import type { DocumentInput } from "../lib/types.ts";

test("chunks preserve page, document, version, and section metadata", () => {
  const chunks = chunkDocument("manual-v2", demoDocuments[1]);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((chunk) => chunk.documentId === "manual-v2" && chunk.version === "v2.0"));
  const audit = chunks.find((chunk) => chunk.section === "Audit export");
  assert.equal(audit?.page, 2);
  assert.match(audit?.text ?? "", /audit:read/);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
});

test("long unbroken paragraphs are bounded and overlap without dropping words", () => {
  const words = Array.from({ length: 430 }, (_, index) => `word${index}`);
  const input: DocumentInput = { filename: "long.txt", title: "Long source", version: "v1", byteSize: 0, pages: [{ page: 3, text: `# Huge paragraph\n\n${words.join(" ")}` }] };
  const chunks = chunkDocument("long", input);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.text.split(" ").length <= 180));
  assert.ok(chunks.every((chunk) => chunk.page === 3 && chunk.section === "Huge paragraph"));
  const first = chunks[0].text.split(" ");
  const second = chunks[1].text.split(" ");
  assert.deepEqual(first.slice(-32), second.slice(0, 32));
  assert.deepEqual(new Set(chunks.flatMap((chunk) => chunk.text.split(" "))), new Set(words));
});

test("chunks never overlap across pages or different sections", () => {
  const input: DocumentInput = { filename: "pages.txt", title: "Source", version: "v1", byteSize: 0, pages: [
    { page: 1, text: "# First\n\nAlpha content.\n\n# Second\n\nBeta content." },
    { page: 2, text: "Gamma content." },
  ] };
  const chunks = chunkDocument("pages", input);
  assert.deepEqual(chunks.map((chunk) => [chunk.page, chunk.section, chunk.text]), [
    [1, "First", "Alpha content."], [1, "Second", "Beta content."], [2, "Second", "Gamma content."],
  ]);
});

test("BM25 ranks the passage covering the question and retains exact identifiers", () => {
  const chunks = demoDocuments.flatMap((document, index) => chunkDocument(`doc-${index}`, document));
  const hits = searchChunks(chunks.filter((chunk) => chunk.version === "v2.0"), "Which scope allows audit exports?", 3);
  assert.equal(hits[0]?.section, "Audit export");
  assert.match(hits[0]?.text ?? "", /audit:read/);
  assert.equal(searchChunks(chunks, "audit:read", 1)[0]?.version, "v2.0");
  assert.equal(searchChunks(chunks, "next_cursor", 1)[0]?.section, "Pagination");
  assert.equal(searchChunks(chunks, "100", 1)[0]?.version, "v1.0");
  assert.ok((hits[0]?.score ?? 0) > 0);
  assert.deepEqual(searchChunks(chunks, "audit:read", 2), searchChunks(chunks, "audit:read", 2));
});

test("section headings are searchable even when their words are absent from the body", () => {
  const chunks = chunkDocument("heading", {
    filename: "heading.txt", title: "Manual", version: "v1", byteSize: 0,
    pages: [{ page: 1, text: "# Authentication\n\nSend a bearer token in the Authorization header." }],
  });
  const hits = searchChunks(chunks, "authentication");
  assert.equal(hits[0]?.section, "Authentication");
  assert.match(extractiveAnswer("authentication", hits), /bearer token.*\[1\]/);
});

test("caller-side version filtering prevents evidence from another release", () => {
  const chunks = demoDocuments.flatMap((document, index) => chunkDocument(`doc-${index}`, document));
  const v1 = searchChunks(chunks.filter((chunk) => chunk.version === "v1.0"), "How long do access tokens last?", 3);
  const v2 = searchChunks(chunks.filter((chunk) => chunk.version === "v2.0"), "How long do access tokens last?", 3);
  assert.ok(v1.length && v2.length);
  assert.ok(v1.every((hit) => hit.version === "v1.0"));
  assert.ok(v2.every((hit) => hit.version === "v2.0"));
  assert.match(extractiveAnswer("How long do access tokens last?", v1), /24 hours/);
  assert.match(extractiveAnswer("How long do access tokens last?", v2), /60 minutes/);
  assert.doesNotMatch(extractiveAnswer("How long do access tokens last?", v2), /24 hours/);
});

test("unknown questions and stopword-only questions abstain", () => {
  const chunks = demoDocuments.flatMap((document, index) => chunkDocument(`doc-${index}`, document));
  assert.deepEqual(searchChunks(chunks, "What is the weather in Tokyo?"), []);
  assert.deepEqual(searchChunks(chunks, "What is Atlas's favorite pizza topping?"), []);
  assert.deepEqual(searchChunks(chunks, "how is the and"), []);
  assert.deepEqual(searchChunks(chunks, "token", 0), []);
  assert.match(extractiveAnswer("weather", []), /couldn't find enough evidence/);
  assert.match(extractiveAnswer("weather", searchChunks(chunks, "audit:read")), /couldn't find enough evidence/);
});

test("extractive answers carry citations to their supplied source ordering", () => {
  const chunks = chunkDocument("auth", demoDocuments[1]);
  const hits = searchChunks(chunks, "access tokens expire", 3);
  const answer = extractiveAnswer("access tokens expire", hits);
  assert.match(answer, /60 minutes/);
  assert.match(answer, /\[1\]/);
  for (const citation of answer.matchAll(/\[(\d+)\]/g)) assert.ok(Number(citation[1]) <= hits.length);
});

test("labeled evaluation actually retrieves expected source sections at three", () => {
  const evaluation = runEvaluation();
  assert.equal(evaluation.total, 10);
  assert.equal(evaluation.passed, 10, JSON.stringify(evaluation.cases.filter((item) => !item.passed), null, 2));
  assert.equal(evaluation.recallAt3, 1);
  assert.ok(evaluation.cases.every((item) => item.expected));
  assert.deepEqual(evaluation.cases.at(-1)?.retrieved, []);
});

test("invalid page coordinates and oversized indexing input fail explicitly", () => {
  const input: DocumentInput = { filename: "invalid.txt", title: "Invalid", version: "v1", byteSize: 0, pages: [{ page: 0, text: "Text" }] };
  assert.throws(() => chunkDocument("invalid", input), /Page numbers/);
  assert.throws(() => chunkDocument("", { ...input, pages: [] }), /document ID/);
  assert.throws(() => chunkDocument("large", { ...input, pages: [{ page: 1, text: "x".repeat(5_000_001) }] }), /indexing limit/);
});
