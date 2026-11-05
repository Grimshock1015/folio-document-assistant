import assert from "node:assert/strict";

// This smoke test deliberately uses the starter's LOCAL development sign-in.
// It cannot target a hosted Site or bypass production authentication.
const base = process.argv[2] || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Run this test against a local development server only.");
const anonymous = await fetch(`${base}/api/documents`);
assert.equal(anonymous.status, 401);
const signin = await fetch(`${base}/signin-with-chatgpt?return_to=/`, { redirect: "manual" });
const cookie = signin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
assert.ok(cookie, "local development sign-in must set a cookie");

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { cookie, "Content-Type": "application/json", ...options.headers } });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { error: raw }; }
  return { status: response.status, data };
}

const firstDemo = await api("/api/demo", { method: "POST" });
assert.equal(firstDemo.status, 200);
assert.equal(firstDemo.data.documents.length, 4);
const secondDemo = await api("/api/demo", { method: "POST" });
assert.deepEqual(firstDemo.data.documents.map((document) => document.id), secondDemo.data.documents.map((document) => document.id));

const filtered = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: "What is the request rate limit?", version: "v2.0" }) });
assert.equal(filtered.status, 200);
assert.ok(filtered.data.sources.length > 0);
assert.ok(filtered.data.sources.every((source) => source.version === "v2.0"));
const unknown = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: "What is the weather in Tokyo?" }) });
assert.equal(unknown.data.mode, "insufficient");
assert.equal(unknown.data.sources.length, 0);
const invalid = await api("/api/documents", { method: "POST", body: JSON.stringify({ filename: "bad.exe" }) });
assert.equal(invalid.status, 400);
const origin = await api("/api/demo", { method: "POST", headers: { Origin: "https://unrelated.example" } });
assert.equal(origin.status, 403);

const uploaded = await api("/api/documents", { method: "POST", body: JSON.stringify({ filename: "smoke-fixture.md", title: "Smoke fixture", version: "test", byteSize: 150, pages: [{ page: 1, text: "# Retention\n\nThe nebulite project retains encrypted backups for 42 days." }, { page: 2, text: "" }, { page: 3, text: "# Recovery\n\nTo restore a nebulite backup, choose Restore in the archive menu." }] }) });
assert.equal(uploaded.status, 200);
try {
  const id = uploaded.data.document.id;
  const answer = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: "What is nebulite backup retention?", documentIds: [id] }) });
  assert.equal(answer.status, 200);
  assert.ok(answer.data.sources.some((source) => source.text.includes("42 days")));
  assert.ok(answer.data.sources.every((source) => source.documentId === id));
} finally {
  assert.equal((await api(`/api/documents/${uploaded.data.document.id}`, { method: "DELETE" })).status, 200);
}
const evaluation = await api("/api/evaluate", { method: "POST" });
assert.equal(evaluation.status, 200);
assert.equal(evaluation.data.passed, evaluation.data.total);
console.log("HTTP smoke passed: auth, demo idempotency, version isolation, abstention, validation, origin checks, upload, retrieval, deletion, evaluation.");
