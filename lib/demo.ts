import type { DocumentInput } from "./types.ts";
import { chunkDocument, searchChunks } from "./rag.ts";

/** Fictional fixtures, deliberately different between releases. Never product advice. */
export const demoDocuments: DocumentInput[] = [
  {
    filename: "atlas-auth-v1.0-sample.txt",
    title: "Atlas authentication guide · sample",
    version: "v1.0",
    byteSize: 1094,
    pages: [
      { page: 1, text: "# Authentication\n\nAtlas v1.0 uses a personal API key for server requests. Send the key in the X-Atlas-Key header. Create one key per service account in Settings > API keys.\n\n# Token lifetime\n\nIn Atlas v1.0, access tokens expire after 24 hours. Refresh tokens remain valid for 30 days. Revoking a service account immediately invalidates its keys and tokens." },
      { page: 2, text: "# Request limits\n\nThe Atlas v1.0 standard plan allows 100 requests per minute per API key. If you exceed the rate limit, the API returns HTTP 429 and a Retry-After header in seconds.\n\n# Audit export\n\nIn Atlas v1.0, only workspace administrators can export the audit log. Audit exports use the GET /v1/audit/export endpoint. Each export contains the preceding 7 days of events." },
    ],
  },
  {
    filename: "atlas-auth-v2.0-sample.txt",
    title: "Atlas authentication guide · sample",
    version: "v2.0",
    byteSize: 1267,
    pages: [
      { page: 1, text: "# Authentication\n\nAtlas v2.0 uses OAuth 2.0 bearer tokens for server requests. Send the access token in the Authorization: Bearer header. Personal API keys and the X-Atlas-Key header are no longer accepted.\n\n# Token lifetime\n\nIn Atlas v2.0, access tokens expire after 60 minutes. Refresh tokens remain valid for 14 days. Rotate a refresh token each time it is exchanged; reusing an old refresh token revokes its token family." },
      { page: 2, text: "# Request limits\n\nThe Atlas v2.0 standard plan allows 300 requests per minute per workspace. If you exceed the rate limit, the API returns HTTP 429 and a Retry-After header in seconds.\n\n# Audit export\n\nIn Atlas v2.0, exporting the audit log requires the audit:read scope. Workspace administrators must grant this scope explicitly. Audit exports use the GET /v2/audit/export endpoint and contain the preceding 30 days of events." },
    ],
  },
  {
    filename: "atlas-migration-v2.0-sample.txt",
    title: "Atlas migration checklist · sample",
    version: "v2.0",
    byteSize: 1136,
    pages: [
      { page: 1, text: "# Upgrade checklist\n\nBefore migrating an Atlas integration from v1.0 to v2.0, replace personal API keys with OAuth bearer tokens. Register a client in Settings > OAuth clients and select the minimum scopes needed by your integration.\n\n# Pagination\n\nAtlas v2.0 list endpoints use cursor pagination. Send the cursor returned in next_cursor as the after query parameter on the next request. The old page and page_size parameters are unsupported. Set the limit parameter to an integer between 1 and 200." },
      { page: 2, text: "# Webhook verification\n\nVerify Atlas v2.0 webhook signatures using HMAC-SHA256 and the raw request body. Compare the computed digest to the X-Atlas-Signature header using a constant-time comparison. Reject webhook timestamps more than 5 minutes old.\n\n# Sandbox rollout\n\nTest the integration against the Atlas sandbox before updating production. The sandbox uses separate OAuth clients and contains fictional records. Run a small canary deployment and monitor HTTP 401 and HTTP 429 errors." },
    ],
  },
  {
    filename: "atlas-operations-v1.0-sample.txt",
    title: "Atlas operations guide · sample",
    version: "v1.0",
    byteSize: 689,
    pages: [
      { page: 1, text: "# Pagination\n\nAtlas v1.0 list endpoints use numbered pagination. Send page and page_size query parameters. The default page_size is 25 records and the maximum page_size is 100 records.\n\n# Webhook verification\n\nVerify Atlas v1.0 webhook signatures using HMAC-SHA256 and the raw request body. Compare the digest to the X-Atlas-Signature header using a constant-time comparison. Reject webhook timestamps more than 10 minutes old.\n\n# Backup retention\n\nAtlas v1.0 retains nightly workspace backups for 7 days. Workspace administrators can request a restore from Settings > Backups." },
    ],
  },
].map((document) => ({
  ...document,
  byteSize: new TextEncoder().encode(document.pages.map((page) => page.text).join("\n\n")).byteLength,
}));

type EvaluationCase = { question: string; version: string; filename?: string; page?: number; section?: string };
const EVALUATION_CASES: EvaluationCase[] = [
  { question: "How long do access tokens last?", version: "v1.0", filename: "atlas-auth-v1.0-sample.txt", page: 1, section: "Token lifetime" },
  { question: "How long do access tokens last?", version: "v2.0", filename: "atlas-auth-v2.0-sample.txt", page: 1, section: "Token lifetime" },
  { question: "What is the request rate limit?", version: "v1.0", filename: "atlas-auth-v1.0-sample.txt", page: 2, section: "Request limits" },
  { question: "What is the request rate limit?", version: "v2.0", filename: "atlas-auth-v2.0-sample.txt", page: 2, section: "Request limits" },
  { question: "Which scope allows audit exports?", version: "v2.0", filename: "atlas-auth-v2.0-sample.txt", page: 2, section: "Audit export" },
  { question: "What are the pagination parameters?", version: "v1.0", filename: "atlas-operations-v1.0-sample.txt", page: 1, section: "Pagination" },
  { question: "How do I paginate with next_cursor?", version: "v2.0", filename: "atlas-migration-v2.0-sample.txt", page: 1, section: "Pagination" },
  { question: "How are webhook signatures verified?", version: "v2.0", filename: "atlas-migration-v2.0-sample.txt", page: 2, section: "Webhook verification" },
  { question: "What is the nightly backup retention?", version: "v1.0", filename: "atlas-operations-v1.0-sample.txt", page: 1, section: "Backup retention" },
  { question: "What is the weather in Tokyo?", version: "v2.0" },
];

export function runEvaluation(): {
  total: number;
  passed: number;
  recallAt3: number;
  cases: Array<{ question: string; expected: string; retrieved: string[]; passed: boolean }>;
} {
  const chunks = demoDocuments.flatMap((document, index) => chunkDocument(`demo-${index + 1}`, document));
  let relevantRetrieved = 0;
  let answerable = 0;
  const cases = EVALUATION_CASES.map((test) => {
    const hits = searchChunks(chunks.filter((chunk) => chunk.version === test.version), test.question, 3);
    const expectedDocumentId = test.filename ? `demo-${demoDocuments.findIndex((document) => document.filename === test.filename) + 1}` : undefined;
    const passed = expectedDocumentId
      ? hits.some((hit) => hit.documentId === expectedDocumentId && hit.page === test.page && hit.section === test.section)
      : hits.length === 0;
    if (expectedDocumentId) {
      answerable++;
      if (passed) relevantRetrieved++;
    }
    return {
      question: `[${test.version}] ${test.question}`,
      expected: test.filename ? `${test.filename} · p.${test.page} · ${test.section}` : "No supporting evidence; abstain",
      retrieved: hits.map((hit) => `${demoDocuments[Number(hit.documentId.slice(5)) - 1].filename} · p.${hit.page} · ${hit.section}`),
      passed,
    };
  });
  return { total: cases.length, passed: cases.filter((test) => test.passed).length, recallAt3: answerable ? relevantRetrieved / answerable : 0, cases };
}
