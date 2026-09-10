import { readFile } from "node:fs/promises";
import { database, closeDatabase } from "../lib/database";
async function main() { try { await database().query(await readFile("migrations/001_durable_processing.sql", "utf8")); console.log("Durable processing migration applied."); } finally { await closeDatabase(); } }
main().catch(() => { console.error("Migration failed; check database access and schema permissions."); process.exitCode = 1; });
