# Portfolio roadmap

## 1. Understand and personalize the starter

Run it, import documentation you know, and trace one question from the browser through the API, database query, ranking function, and citation panel. Replace the fictional samples with a collection you can explain. Write down why the current keyword retriever succeeds or fails on your questions.

## 2. Build a real evaluation set

Create 30–50 manually checked questions and keep a held-out subset. Include synonyms, exact identifiers, facts split across passages, contradictory versions, and questions that cannot be answered from the collection. Measure retrieval separately from the generated response.

## 3. Add semantic and hybrid retrieval

Implement embedding generation and a vector index, preserving document ownership and version filters. Compare BM25, vector search, and a combined rank-fusion approach. Add reranking only if the quality gain justifies latency and cost on your evaluation set.

## 4. Improve document ingestion

Add incremental reindexing and document deduplication. Then choose one harder format problem, such as OCR, structured tables, or retaining PDF text coordinates for highlighted citations. Test it with varied real files.

## 5. Strengthen generated answers

Evaluate whether each claim is supported by its citation. Add adversarial document-instruction examples, missing-evidence cases, and contradictory sources. Add provider tracing that records timing and token counts without logging private content or secrets. Consider streaming and bounded retry behavior.

## 6. Prepare the recruiting demo

Record a short demo showing a version difference, a correct citation, an unsupported question, and an actual evaluation comparison. Publish a concise architecture explanation, setup instructions, meaningful tests, and measured results. In your resume, report only improvements and usage you actually measured; describe which components you implemented and can explain.
