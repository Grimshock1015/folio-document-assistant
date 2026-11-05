import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAnswer, hasValidCitations } from "../lib/generation.ts";
import type { SearchHit } from "../lib/types.ts";

test("citation checks require references within the retrieved source range", () => {
  assert.equal(hasValidCitations("The limit is 10 [1].", 2), true);
  assert.equal(hasValidCitations("The limit is 10.", 2), false);
  assert.equal(hasValidCitations("See [0].", 2), false);
  assert.equal(hasValidCitations("See [1] and [3].", 2), false);
});

test("provider prompt includes source versions and rejects invented citations", async () => {
  const original = globalThis.fetch;
  const hits: SearchHit[] = [{ id: "c1", documentId: "d1", documentName: "Guide", version: "v2", page: 2, section: "Limits", text: "The upload limit is 10 MB.", score: 1 }];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init?.body as string);
    const context = JSON.parse(body.messages[0].content);
    assert.equal(context.sources[0].version, "v2");
    assert.match(body.system, /untrusted data/);
    return Response.json({ content: [{ type: "text", text: "The upload limit is 10 MB [7]." }], stop_reason: "end_turn" });
  };
  try { await assert.rejects(generateAnswer("What is the limit?", hits, "test-key", "test-model"), /ProviderCitationCheckFailed/); }
  finally { globalThis.fetch = original; }
});

test("provider path returns a cited answer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ content: [{ type: "text", text: "The upload limit is 10 MB [1]." }], stop_reason: "end_turn" });
  try {
    assert.equal(await generateAnswer("What is the limit?", [{ id: "c1", documentId: "d1", documentName: "Guide", version: "v2", page: 1, section: "", text: "The upload limit is 10 MB.", score: 1 }], "test-key", "test-model"), "The upload limit is 10 MB [1].");
  } finally { globalThis.fetch = original; }
});
