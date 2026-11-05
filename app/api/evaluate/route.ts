import { checkOrigin, owner, respond } from "@/lib/api";
import { runEvaluation } from "@/lib/demo";
export async function POST(request: Request) {
  return respond(async () => {
    await owner();
    checkOrigin(request);
    return runEvaluation();
  });
}
