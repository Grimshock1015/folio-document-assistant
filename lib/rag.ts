import type { Chunk, DocumentInput, SearchHit } from "./types.ts";

const CHUNK_WORDS = 180;
const OVERLAP_WORDS = 32;
const MAX_SOURCE_CHARACTERS = 5_000_000;
const MAX_CHUNKS = 20_000;
const NO_EVIDENCE =
  "I couldn't find enough evidence in the selected documents to answer that. Try a more specific question or select another version.";

const STOPWORDS = new Set(
  ("a an and are as at be been being but by can could did do does doing for from had has have having " +
    "he her hers him his how i if in into is it its me my of on or our ours please she should so some " +
    "than that the their theirs them then there these they this those to too us was we were what when " +
    "where which who why will with would you your yours tell explain show about also any get give " +
    "use using used much many long").split(/\s+/),
);

/** Keep identifiers and version numbers intact; normalize ordinary plural nouns. */
function tokens(text: string): string[] {
  const matches = text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:[._:/-][\p{L}\p{N}]+)*/gu) ?? [];
  return matches
    .map((word) => {
      if (/^[a-z]+$/.test(word)) {
        if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
        if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
      }
      return word;
    })
    .filter((word) => !STOPWORDS.has(word) && (word.length > 1 || /^\d$/.test(word)));
}

function looksLikeHeading(line: string, before: string, after: string): boolean {
  if (/^#{1,6}\s+\S/.test(line)) return true;
  if (!line || line.length > 90 || line.split(/\s+/).length > 10) return false;
  if (/^[-*•\d]|[.!?;:]$/.test(line)) return false;
  if (/^[A-Z][A-Z\d\s&/()-]+$/.test(line)) return true;
  return !before.trim() && Boolean(after.trim()) && /^[A-Z]/.test(line) && !/[/=<>`]/.test(line);
}

/** Page-local chunks retain source coordinates and overlap at long-block boundaries. */
export function chunkDocument(documentId: string, input: DocumentInput): Chunk[] {
  if (!documentId.trim()) throw new Error("A document ID is required.");
  let characters = 0;
  for (const page of input.pages) {
    characters += page.text.length;
    if (characters > MAX_SOURCE_CHARACTERS) {
      throw new Error("This document exceeds the 5 million character indexing limit.");
    }
    if (!Number.isInteger(page.page) || page.page < 1) throw new Error("Page numbers must be positive integers.");
  }

  const chunks: Chunk[] = [];
  let inheritedSection = input.title || input.filename;
  for (const page of input.pages) {
    const lines = page.text.replace(/\r\n?/g, "\n").split("\n");
    let section = inheritedSection;
    let paragraph: string[] = [];
    let words: string[] = [];

    const emit = () => {
      if (!words.length) return;
      if (chunks.length >= MAX_CHUNKS) throw new Error("This document exceeds the 20,000 chunk indexing limit.");
      chunks.push({
        id: `${documentId}:p${page.page}:c${chunks.length + 1}`,
        documentId,
        documentName: input.title || input.filename,
        version: input.version,
        page: page.page,
        section,
        text: words.join(" "),
      });
    };

    const consumeParagraph = () => {
      if (!paragraph.length) return;
      const incoming = paragraph.join(" ").split(/\s+/).filter(Boolean);
      paragraph = [];
      for (const word of incoming) {
        if (words.length === CHUNK_WORDS) {
          emit();
          words = words.slice(-OVERLAP_WORDS);
        }
        words.push(word);
      }
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (looksLikeHeading(line, lines[index - 1] ?? "", lines[index + 1] ?? "")) {
        consumeParagraph();
        emit();
        words = [];
        section = line.replace(/^#{1,6}\s+/, "").trim();
      } else if (!line) {
        consumeParagraph();
      } else {
        paragraph.push(line);
      }
    }
    consumeParagraph();
    emit();
    inheritedSection = section;
  }
  return chunks;
}

function counts(words: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const word of words) result.set(word, (result.get(word) ?? 0) + 1);
  return result;
}

/** Exact lexical retrieval: scores rank evidence; they are not answer confidence. */
export function searchChunks(chunks: Chunk[], query: string, limit = 5): SearchHit[] {
  const queryTerms = [...new Set(tokens(query.slice(0, 4_000)))];
  const resultLimit = Number.isFinite(limit) ? Math.min(50, Math.max(0, Math.floor(limit))) : 5;
  if (!queryTerms.length || !chunks.length || !resultLimit) return [];

  const documents = chunks.map((chunk) => {
    const body = tokens(`${chunk.section}\n${chunk.text}`);
    return { chunk, body, frequency: counts(body), metadata: new Set(tokens(`${chunk.section} ${chunk.documentName}`)) };
  });
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, documents.reduce((sum, doc) => sum + Number(doc.frequency.has(term)), 0));
  }
  const averageLength = documents.reduce((sum, doc) => sum + doc.body.length, 0) / documents.length || 1;
  const distinctiveTerms = queryTerms.filter((term) => (documentFrequency.get(term) ?? 0) / documents.length < 0.8);
  const hits: SearchHit[] = [];
  for (const doc of documents) {
    const matched = queryTerms.filter((term) => doc.frequency.has(term));
    if (!matched.length) continue;
    // Shared product names alone are insufficient evidence for an unrelated question.
    if (distinctiveTerms.length && !distinctiveTerms.some((term) => doc.frequency.has(term)) && matched.length / queryTerms.length < 0.6) continue;
    // A lone incidental overlap in a detailed question is too weak to retrieve.
    if (queryTerms.length >= 3 && matched.length < 2 && !matched.some((term) => /[\d._:/-]/.test(term))) continue;

    let score = 0;
    for (const term of matched) {
      const frequency = doc.frequency.get(term) ?? 0;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const lengthAdjustment = 1.2 * (0.25 + 0.75 * doc.body.length / averageLength);
      score += idf * frequency * 2.2 / (frequency + lengthAdjustment);
      if (doc.metadata.has(term)) score += idf * 0.2;
    }
    // Prefer passages covering the whole question over a repeated single keyword.
    score *= 0.6 + 0.4 * matched.length / queryTerms.length;
    hits.push({ ...doc.chunk, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.page - b.page || a.id.localeCompare(b.id))
    .slice(0, resultLimit);
}

/** Quote relevant source sentences with citations, without inventing a synthesis. */
export function extractiveAnswer(query: string, hits: SearchHit[]): string {
  if (!hits.length) return NO_EVIDENCE;
  const relevant = new Set(searchChunks(hits, query, hits.length).map((hit) => hit.id));
  if (!relevant.size) return NO_EVIDENCE;
  const queryTerms = new Set(tokens(query));
  const candidates: Array<{ text: string; source: number; score: number }> = [];
  hits.forEach((hit, source) => {
    if (!relevant.has(hit.id)) return;
    const sentences = hit.text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/);
    const sectionTerms = new Set(tokens(hit.section));
    const sectionMatches = [...queryTerms].filter((term) => sectionTerms.has(term)).length;
    for (let index = 0; index < sentences.length; index++) {
      const sentence = sentences[index];
      const sentenceTerms = new Set(tokens(sentence));
      const matches = [...queryTerms].filter((term) => sentenceTerms.has(term)).length;
      if (!matches && !(index === 0 && sectionMatches)) continue;
      const score = (matches + sectionMatches * 0.45) / Math.sqrt(Math.max(8, sentenceTerms.size)) + 0.04 / (source + 1);
      candidates.push({ text: sentence.trim(), source, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.source - b.source);
  const chosen: typeof candidates = [];
  let length = 0;
  for (const candidate of candidates) {
    if (chosen.length === 3 || length > 1_200) break;
    const candidateTerms = new Set(tokens(candidate.text));
    const duplicate = chosen.some((other) => {
      const otherTerms = new Set(tokens(other.text));
      const shared = [...candidateTerms].filter((term) => otherTerms.has(term)).length;
      return shared / Math.max(1, Math.min(candidateTerms.size, otherTerms.size)) > 0.85;
    });
    if (duplicate) continue;
    const text = candidate.text.length > 900 ? candidate.text.slice(0, 897).trimEnd() + "…" : candidate.text;
    chosen.push({ ...candidate, text });
    length += text.length;
  }
  return chosen.length ? chosen.map((item) => `${item.text} [${item.source + 1}]`).join("\n\n") : NO_EVIDENCE;
}
