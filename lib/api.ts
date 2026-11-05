import { getChatGPTUser } from "@/app/chatgpt-auth";

export class HttpError extends Error {
  public status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function owner() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, "Sign in to use your document library.");
  return user.userId;
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "This request must come from the document assistant.");
}

export async function readJson(request: Request, maxBytes = 2_000_000): Promise<unknown> {
  checkOrigin(request);
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Send document content as JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "The request is empty.");
  let bytes = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new HttpError(413, "This document is too large. Try a smaller document."); }
    parts.push(next.value);
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new HttpError(400, "The request contains invalid JSON."); }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid request.");
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new HttpError(400, `${name} must contain 1–${maxLength} characters.`);
  return value.trim();
}

export async function respond(action: () => Promise<unknown>) {
  try { return Response.json(await action(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Folio request failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
