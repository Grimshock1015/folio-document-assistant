import { checkOrigin, owner, respond } from "@/lib/api";
import { demoDocuments } from "@/lib/demo";
import { saveDocuments } from "@/lib/library";
export async function POST(request: Request) {
  return respond(async () => {
    const userId = await owner();
    checkOrigin(request);
    const items = [];
    for (const [i, document] of demoDocuments.entries()) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:folio-demo:${i}`));
      const id = "sample-" + Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      items.push({ input: document, stableId: id });
    }
    return { documents: await saveDocuments(userId, items) };
  });
}
