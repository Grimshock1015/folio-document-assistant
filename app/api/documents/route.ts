import { owner, readJson, respond } from "@/lib/api";
import { listDocuments, saveDocument, validateDocument } from "@/lib/library";
export async function GET() {
  return respond(async () => ({ documents: await listDocuments(await owner()) }));
}
export async function POST(request: Request) {
  return respond(async () => {
    const userId = await owner();
    return { document: await saveDocument(userId, validateDocument(await readJson(request))) };
  });
}
