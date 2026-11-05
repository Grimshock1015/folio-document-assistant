import { HttpError, owner, respond } from "@/lib/api";
import { removeDocument } from "@/lib/library";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "This request must come from the document assistant.");
    const userId = await owner();
    const { id } = await context.params;
    await removeDocument(userId, id);
    return { ok: true };
  });
}
