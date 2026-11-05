import { env } from "cloudflare:workers";
import { HttpError, object, owner, readJson, respond, text } from "@/lib/api";
import { generateAnswer } from "@/lib/generation";
import { getModelConfig } from "@/lib/model-config";
import { getChunks, listDocuments } from "@/lib/library";
import { extractiveAnswer, searchChunks } from "@/lib/rag";
export async function POST(request: Request) {
  return respond(async () => {
    const started = performance.now();
    const userId = await owner();
    const body = object(await readJson(request, 10_000));
    const question = text(body.question, "Question", 1500);
    let documentIds: string[] | undefined;
    if (body.documentIds !== undefined) {
      if (!Array.isArray(body.documentIds) || body.documentIds.length > 30 || body.documentIds.some((id) => typeof id !== "string" || id.length > 100)) throw new HttpError(400, "Select valid documents.");
      documentIds = body.documentIds as string[];
      if (documentIds.length === 0) throw new HttpError(400, "Select at least one document.");
    }
    const version = body.version ? text(body.version, "Version", 40) : undefined;
    const documents = await listDocuments(userId);
    const chunks = await getChunks(userId, documentIds, version);
    const hits = searchChunks(chunks, question, 5);
    const retrievalMs = Math.round(performance.now() - started);
    const sources = hits.map((hit, i) => ({ id: i + 1, documentId: hit.documentId, title: hit.documentName, filename: documents.find((doc) => doc.id === hit.documentId)?.filename ?? "", version: hit.version, page: hit.page, section: hit.section, text: hit.text, score: hit.score }));
    let mode: "sources" | "ai" | "insufficient" = hits.length ? "sources" : "insufficient";
    let answer = hits.length ? extractiveAnswer(question, hits) : "I couldn't find enough relevant evidence in the selected documents. Try a more specific question, choose another version, or add a document that covers the topic.";
    let warning: string | undefined;
    let generationMs = 0;
    const modelConfig = getModelConfig(env);
    if (hits.length && modelConfig) {
      const generationStarted = performance.now();
      try {
        answer = await generateAnswer(question, hits, modelConfig.apiKey, modelConfig.model, modelConfig);
        mode = "ai";
      } catch (error) {
        warning = error instanceof Error && error.message === "ProviderModelNotEnabled"
          ? `AI Space has not enabled ${modelConfig.model} for this account. Enable it or select an available model in the server settings. Showing source passages instead.`
          : "AI generation is unavailable or did not pass citation checks. Showing source passages instead.";
      }
      generationMs = Math.round(performance.now() - generationStarted);
    }
    return { mode, answer, sources, metrics: { retrievalMs, generationMs, totalMs: Math.round(performance.now() - started), chunksSearched: chunks.length }, ...(warning ? { warning } : {}) };
  });
}
