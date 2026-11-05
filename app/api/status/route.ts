import { env } from "cloudflare:workers";
import { owner, respond } from "@/lib/api";
import { getModelConfig } from "@/lib/model-config";
export async function GET() {
  return respond(async () => {
    await owner();
    const config = getModelConfig(env);
    return { generationConfigured: Boolean(config), model: config?.model ?? null, provider: config?.provider ?? null };
  });
}
