# Evaluation notes

Folio separates document retrieval from answer generation. This follows the distinction between process evaluation and final-response evaluation in [Microsoft's RAG evaluation guidance](https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators?view=foundry).

## Included benchmark

`lib/demo.ts` contains four fictional Atlas guides across v1.0 and v2.0. Ten fixed questions have manually specified expected documents, pages, and sections.

- Nine answerable questions: token lifetime, rate limits, audit scope, pagination, webhook verification, and retention.
- One unsupported question about the weather: expected to retrieve no evidence.
- Version filters are applied before searching.
- A question passes when its expected source section appears in the top three results; the unsupported case passes when no hits are returned.
- Recall@3 is the fraction of the nine answerable questions with the labeled source in the top three. Each case currently has one labeled relevant passage.

The initial fixture run passes 10/10 with recall@3 of 1.0. These questions were used during implementation. This is a regression result on a very small known collection, not a held-out generalization estimate. Adding real documents can expose synonym, extraction, ranking, and context-selection failures.

## Additional automated checks

`npm test` checks chunk boundaries and overlap, page/section metadata, identifier retrieval, explicit version isolation, unsupported queries, citations, provider-contract behavior, quotas, and atomic rollback. Provider calls are mocked, so these checks do not measure live answer faithfulness.

`npm run test:smoke` exercises the actual local HTTP routes and persistent database. It does not bypass production authentication and refuses non-localhost targets.

## Next experiment

1. Choose one real documentation collection and freeze an independent 30–50-question test set.
2. Label relevant passages, expected version, and whether an answer is possible. Include paraphrases with little keyword overlap.
3. Compare BM25, vector retrieval, hybrid retrieval, and optional reranking on the same held-out cases.
4. Record recall@k and ranking quality separately from answer correctness and evidence support. Review model-based judgments manually on a sample.
5. Report p50/p95 latency, ingestion time, per-query provider cost, unsupported-answer behavior, and concrete failures.

Keep the document collection, model configuration, chunking parameters, test questions, and code revision with each result. Choose pipeline changes based on measured tradeoffs rather than assuming more components improve quality. See [Anthropic's contextual retrieval experiments](https://www.anthropic.com/research/contextual-retrieval) for one example of retrieval comparisons and cost/latency considerations.
