import DocumentAssistant from "@/components/document-assistant";
import { requireChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <DocumentAssistant displayName={user.displayName} />;
}
