import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["scripts/copy-pdf-worker.mjs"]);
// Keep CLI migration paths independent of generated build directory depth.
mkdirSync(".sites-runtime", { recursive: true });
writeFileSync(".sites-runtime/local-migrations.json", JSON.stringify({ name: "folio-local-migrations", compatibility_date: "2026-05-15", d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: "../drizzle" }] }));
// Wrangler records migration files; reruns preserve existing documents.
run(["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local", "--config", ".sites-runtime/local-migrations.json", "--persist-to", process.env.FOLIO_LOCAL_STATE_DIR || ".wrangler/state"]);
