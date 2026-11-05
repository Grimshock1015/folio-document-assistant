import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAnswer, readResponsesAnswer } from "../lib/generation.ts";
import { getModelConfig } from "../lib/model-config.ts";
import type { SearchHit } from "../lib/types.ts";

// Deliberately fictional fixture values. Every generation request is intercepted.
const FIXTURE_TOKEN = "fixture-only-not-a-real-token";
const hits: SearchHit[] = [{
  id: "chunk-1", documentId: "document-1", documentName: "Atlas sample guide",
  version: "v2.0", page: 2, section: "Request limits",
  text: "The Atlas standard plan allows 300 requests per minute.", score: 1,
}];
const citedAnswer = "The standard plan allows 300 requests per minute [1].";

function completed(text = citedAnswer) {
  return {
    status: "completed",
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }],
  };
}

async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); }
  finally { globalThis.fetch = original; }
}

test("shared configuration defaults to AI Space when its fixture key is available", () => {
  const config = getModelConfig({ AISPACE_API_KEY: ` ${FIXTURE_TOKEN} ` });
  assert.deepEqual(config, {
    provider: "aispace", apiKey: FIXTURE_TOKEN,
    model: "gpt-6.1-sol", baseUrl: "https://ai.xyspace.dev/v1",
  });
  assert.equal(getModelConfig({}), null);
  assert.equal(getModelConfig({ AISPACE_API_KEY: " \t", ANTHROPIC_API_KEY: " " }), null);
});

test("explicit provider selection wins and never falls back to a different provider", () => {
  const both = { AISPACE_API_KEY: FIXTURE_TOKEN, ANTHROPIC_API_KEY: "fictional-legacy-fixture" };
  assert.equal(getModelConfig(both)?.provider, "aispace");
  assert.equal(getModelConfig({ ...both, LLM_PROVIDER: " anthropic " })?.provider, "anthropic");
  assert.equal(getModelConfig({ ...both, LLM_PROVIDER: "aispace" })?.model, "gpt-6.1-sol");
  assert.equal(getModelConfig({ ANTHROPIC_API_KEY: "fictional-legacy-fixture", LLM_PROVIDER: "aispace" }), null);
  assert.equal(getModelConfig({ AISPACE_API_KEY: FIXTURE_TOKEN, LLM_PROVIDER: "anthropic" }), null);
  assert.equal(getModelConfig({ ...both, LLM_PROVIDER: "unsupported-provider" }), null);
});

test("provider model and base URL overrides are trimmed without changing legacy defaults", () => {
  const config = getModelConfig({
    AISPACE_API_KEY: FIXTURE_TOKEN, AISPACE_MODEL: " custom-fixture-model ",
    AISPACE_BASE_URL: " https://example.invalid/v1/ ",
  });
  assert.equal(config?.model, "custom-fixture-model");
  assert.equal(config?.baseUrl, "https://example.invalid/v1/");
  const legacy = getModelConfig({ ANTHROPIC_API_KEY: "fictional-legacy-fixture" });
  assert.equal(legacy?.provider, "anthropic");
  assert.equal(legacy?.model, "claude-haiku-4-5");
});

test("AI Space sends the Responses request contract and source metadata", async () => {
  let calls = 0;
  await withFetch(async (input, init) => {
    calls++;
    assert.equal(String(input), "https://ai.xyspace.dev/v1/responses");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${FIXTURE_TOKEN}`);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.has("x-api-key"), false);
    assert.equal(headers.has("anthropic-version"), false);
    assert.ok(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6.1-sol");
    assert.equal(body.max_output_tokens, 2400);
    assert.equal(body.stream, false);
    assert.equal(body.store, false);
    assert.match(body.instructions, /untrusted data/);
    assert.match(body.instructions, /Cite every factual claim/);
    assert.equal(body.messages, undefined);
    const context = JSON.parse(body.input);
    assert.equal(context.question, "What is the request limit?");
    assert.deepEqual(context.sources, [{
      citation: 1, title: "Atlas sample guide", version: "v2.0", page: 2,
      section: "Request limits", passage: hits[0].text,
    }]);
    return Response.json(completed());
  }, async () => {
    assert.equal(await generateAnswer("What is the request limit?", hits, FIXTURE_TOKEN, "gpt-6.1-sol", { provider: "aispace" }), citedAnswer);
  });
  assert.equal(calls, 1);
});

test("AI Space normalizes trailing base URL slashes and rejects insecure endpoints before fetch", async () => {
  let calls = 0;
  await withFetch(async (input) => {
    calls++;
    assert.equal(String(input), "https://example.invalid/v1/responses");
    return Response.json(completed());
  }, async () => {
    await generateAnswer("request limit", hits, FIXTURE_TOKEN, "fixture-model", { provider: "aispace", baseUrl: "https://example.invalid/v1///" });
    await assert.rejects(
      generateAnswer("request limit", hits, FIXTURE_TOKEN, "fixture-model", { provider: "aispace", baseUrl: "http://example.invalid/v1" }),
      /ProviderEndpointInvalid/,
    );
  });
  assert.equal(calls, 1);
});

test("raw Responses parsing joins assistant text blocks and ignores reasoning and tool output", () => {
  const result = readResponsesAnswer({
    status: "completed",
    output_text: "This SDK convenience field must not be used [99].",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "Private reasoning [99]." }], content: [{ type: "output_text", text: "Wrong reasoning content." }] },
      { type: "function_call", name: "fixture", arguments: "Tool arguments [99]." },
      { type: "function_call_output", output: "Tool output [99]." },
      { type: "message", role: "user", content: [{ type: "output_text", text: "User text [99]." }] },
      { type: "message", role: "assistant", status: "completed", content: [
        { type: "output_text", text: "First sourced fact [1]." },
        { type: "unknown_block", text: "Unknown text [99]." },
        { type: "output_text", text: "Second sourced fact [1]." },
      ] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Final sourced fact [1]." }] },
    ],
  });
  assert.equal(result, "First sourced fact [1].\nSecond sourced fact [1].\nFinal sourced fact [1].");
});

test("Responses parsing rejects incomplete, failed, pending, and malformed top-level statuses", () => {
  for (const status of [undefined, null, false, 0, "", "incomplete", "failed", "cancelled", "queued", "in_progress", "unexpected"]) {
    assert.throws(() => readResponsesAnswer({ ...completed(), status }), /ProviderAnswerIncomplete/, `status ${String(status)}`);
  }
  assert.throws(() => readResponsesAnswer({ ...completed(), error: { code: "fixture_error" } }), /ProviderAnswerIncomplete/);
  assert.throws(() => readResponsesAnswer({ ...completed(), incomplete_details: { reason: "max_output_tokens" } }), /ProviderAnswerIncomplete/);
  for (const value of [undefined, null, [], "invalid"]) assert.throws(() => readResponsesAnswer(value), /ProviderAnswerIncomplete/);
});

test("Responses parsing rejects unfinished or explicitly malformed assistant message statuses", () => {
  for (const status of ["incomplete", "in_progress", "failed", "unexpected", null, false, 0, ""]) {
    assert.throws(() => readResponsesAnswer({
      status: "completed",
      output: [{ type: "message", role: "assistant", status, content: [{ type: "output_text", text: citedAnswer }] }],
    }), /ProviderAnswerIncomplete/, `message status ${String(status)}`);
  }
});

test("Responses refusals reject the whole answer even beside valid cited text", () => {
  const refusal = { type: "refusal", refusal: "This is a fictional refusal fixture." };
  const text = { type: "output_text", text: citedAnswer };
  for (const content of [[refusal], [text, refusal], [refusal, text]]) {
    assert.throws(() => readResponsesAnswer({ status: "completed", output: [{ type: "message", role: "assistant", content }] }), /ProviderAnswerRefused/);
  }
});

test("malformed Responses output cannot become a valid generated answer", async () => {
  const malformed = [
    { status: "completed" },
    { status: "completed", output: {} },
    { status: "completed", output: [{ type: "message", role: "assistant", content: null }] },
    { status: "completed", output: [] },
    { status: "completed", output_text: citedAnswer, output: [] },
    { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: 123 }] }] },
  ];
  for (const response of malformed) {
    await withFetch(async () => Response.json(response), async () => {
      await assert.rejects(generateAnswer("request limit", hits, FIXTURE_TOKEN, "gpt-6.1-sol", { provider: "aispace" }), /Provider(OutputMissing|CitationCheckFailed)/);
    });
  }
});

test("AI Space generation rejects empty answers, missing citations, and invented citations", async () => {
  for (const answer of ["", "No citation is present.", "The limit is 300 [0].", "The limit is 300 [2].", "A valid reference [1] followed by an invented one [9]."]) {
    await withFetch(async () => Response.json(completed(answer)), async () => {
      await assert.rejects(generateAnswer("request limit", hits, FIXTURE_TOKEN, "gpt-6.1-sol", { provider: "aispace" }), /ProviderCitationCheckFailed/);
    });
  }
});

test("AI Space HTTP failures, invalid JSON, and network errors reject for caller fallback", async () => {
  for (const status of [401, 429, 503]) {
    await withFetch(async () => Response.json({ error: "Fictional provider failure." }, { status }), async () => {
      await assert.rejects(generateAnswer("request limit", hits, FIXTURE_TOKEN, "gpt-6.1-sol", { provider: "aispace" }), new RegExp(`ProviderRequestFailed:${status}`));
    });
  }
  await withFetch(async () => new Response("{not valid json", { status: 200 }), async () => {
    await assert.rejects(generateAnswer("request limit", hits, FIXTURE_TOKEN, "gpt-6.1-sol", { provider: "aispace" }), SyntaxError);
  });
  await withFetch(async () => { throw new TypeError("Fictional disconnected network."); }, async () => {
    await assert.rejects(generateAnswer("request limit", hits, FIXTURE_TOKEN, "gpt-6.1-sol", { provider: "aispace" }), /Fictional disconnected network/);
  });
});
test("disabled models surface a safe actionable error without exposing provider details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: "model_not_enabled", message: "private provider details" } }, { status: 400 });
  try {
    await assert.rejects(generateAnswer("What is the limit?", [{ id: "c", documentId: "d", documentName: "Guide", version: "v1", page: 1, section: "Limits", text: "The upload limit is 10 MB.", score: 1 }], "fixture-key", "gpt-6.1-sol", { provider: "aispace" }), /^Error: ProviderModelNotEnabled$/);
  } finally { globalThis.fetch = original; }
});
