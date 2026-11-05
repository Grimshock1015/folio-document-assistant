declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    LLM_PROVIDER?: string;
    AISPACE_API_KEY?: string;
    AISPACE_BASE_URL?: string;
    AISPACE_MODEL?: string;
  }
}
