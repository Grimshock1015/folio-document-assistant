# Folio — Document Assistant

A working portfolio starter for asking questions about versioned documents and inspecting the evidence behind each response.

This repository contains application source and empty configuration examples. API keys, uploaded documents, local database state, and the original hosting project identity are not included.

## What works

- PDF (selectable text), Markdown, and text uploads; browser-side extraction preserves PDF page numbers.
- Persistent, user-scoped document library with titles, versions, and deletion.
- Page/section-aware chunks with overlap and deterministic BM25 keyword retrieval.
- Explicit document and version filters applied before retrieval.
- Clickable citations that reveal the exact retrieved passages.
- A source-search mode that works without an API key.
- Optional GPT-6.1 Sol answers through AI Space's Responses API, grounded in retrieved passages, with citation range checks and graceful fallback. The earlier Anthropic adapter is also available.
- An isolated evaluation using 10 labeled fictional sample questions, plus unit/database tests and an HTTP smoke test.

## Run locally

Requires Node.js 22.19 or newer and npm. No Python or paid cloud account is needed for the source-search mode.

```sh
npm ci
npm run setup
npm run dev
```

Open the Local URL printed by the dev server (normally http://localhost:5173). Local development simulates sign-in using the starter's local test account. Production uses Sites authentication; the local mock is excluded from production builds.

Click **Load sample collection**, choose a document version, then ask **What is the request rate limit?** Click a numbered citation to inspect the passage. The Atlas documents are fictional fixtures.

`npm run setup` applies only pending migrations to the local database and preserves existing documents. Local state lives in `.wrangler/state` and is excluded from Git and the source ZIP.

## Enable AI answers

The default experience deliberately identifies itself as **Source search**. It returns extracted evidence, without claiming an AI model generated an answer.

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Set your own `AISPACE_API_KEY` in that local file.
3. Keep `LLM_PROVIDER=aispace`, `AISPACE_BASE_URL=https://ai.xyspace.dev/v1`, and `AISPACE_MODEL=gpt-6.1-sol` (the default), or explicitly choose another model enabled for your account.
4. Restart the dev server. The app detects whether generation is configured.

For the hosted Site, configure the same names as server-side runtime environment variables through Sites and deploy a new version. Never put a secret in a React component, a hosting manifest, a commit, or a screenshot. API usage is billed to your provider account. There is no client-side key-entry form.

When AI Space mode is enabled, the question and top retrieved passages are sent to the configured AI Space endpoint. The full original PDF is not sent by this app. The provider must be available and the configured model must be accessible to your account. Provider errors, timeouts, incomplete replies, refusals, and invalid citation references fall back to clearly labeled source passages. Responses are requested with `store: false`; check your provider's own data handling policies for its storage behavior.

The AI Space adapter sends a non-streaming request to `/v1/responses` using Bearer authentication. It reads assistant text from raw Responses output, ignores reasoning/tool items, and requires a completed response with valid citation numbers. The adapter follows the [Responses text-generation interface](https://developers.openai.com/api/docs/guides/text). AI Space is a separate third-party service; its available models are determined by your provider account. Your Codex `config.toml` does not configure this app.

To use the earlier Anthropic adapter instead, set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL`. Provider selection is shared between the status and question routes; the app never silently substitutes a different provider or model after an error.

If AI Space returns `model_not_enabled`, the app explains that the configured model is unavailable and shows source passages. Enable that model with your provider or explicitly change `AISPACE_MODEL` to one your account permits. An accepted API key does not establish access to every model.

The `gpt-6.1-sol` adapter was verified with a live request on November 5, 2026: a fictional source passage produced a completed, cited answer. Automated tests use mocked provider responses for repeatable validation; this single live check is not an accuracy benchmark.

## Verify

```sh
npm run check
npm test
npm run build
```

With the dev server running in another terminal:

```sh
npm run test:smoke
```

The HTTP smoke test is restricted to localhost. It checks authentication, sample-import idempotency, version isolation, unsupported questions, validation, origin enforcement, upload, retrieval, deletion, and evaluation. It creates and removes one disposable fixture document; the sample collection stays available.

The Evaluation tab runs a fixed in-memory fixture benchmark, independently of the documents currently in your library. Its recall@3 metric checks whether the labeled relevant passage appears among the top three hits, across nine answerable cases. The tenth case checks an unsupported question. These small fixtures are a regression check, not evidence of general accuracy or model-answer quality. See [EVALUATION.md](EVALUATION.md).

## Project map

| Path | Responsibility |
| --- | --- |
| `components/document-assistant.tsx` | Ask, Library, Evaluation, uploads, and evidence panels |
| `lib/parse-document.ts` | Browser-side PDF/text extraction |
| `lib/rag.ts` | Chunking, BM25 ranking, and source-only excerpts |
| `lib/generation.ts` | Server-side model request and citation range checks |
| `lib/model-config.ts` | Shared server-side provider and model selection |
| `lib/library.ts` | Validation and owner-scoped persistent storage |
| `lib/demo.ts` | Fictional Atlas docs and labeled retrieval benchmark |
| `app/api/` | Document lifecycle, questions, status, samples, evaluation |
| `db/schema.ts` and `drizzle/` | D1 schema, migrations, and transactional quota guards |
| `tests/` | Retrieval, generation-contract, database, and HTTP checks |

The app uses React/TypeScript, Vinext/Vite, and Cloudflare D1. The bundled Sites runtime scripts handle preview and deployment. `npm start` previews the built Worker; `npm run dev` is the normal development command.

## Current limits

- Keyword retrieval is implemented; embeddings, vector search, hybrid retrieval, and reranking are future milestones.
- Version selection is explicit. A question mentioning a version does not automatically change the version filter.
- Each file: 5,000,000 bytes, 100 pages, 300,000 extracted characters, and at most 600 indexed chunks.
- Each library: 30 documents and 4,000 chunks. Database triggers enforce quotas even during concurrent writes.
- Scanned PDFs need OCR before importing. DOCX, tables/charts interpretation, and OCR are outside this version.
- Source text and metadata are stored; original file binaries and chat history are not stored. Your visible conversation lasts until page reload or a new session.
- A valid citation number does not prove a claim is correct. Verify the original evidence. Keyword overlap is not calibrated confidence, and abstention is heuristic.
- The hosted Site starts private. Public sharing, production abuse controls, billing, and team collaboration are separate future work.

## Make it your portfolio project

Start by importing documentation for a real library you use. Add 30–50 manually checked questions, including ambiguous versions and unanswerable cases. Then add embeddings and compare retrieval against the current BM25 baseline. Publish measured changes in retrieval success, answer support, latency, and cost, including failures and tradeoffs.

A useful next sequence is in [ROADMAP.md](ROADMAP.md).
