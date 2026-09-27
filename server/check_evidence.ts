import { getDb } from "./db";
import { evidence } from "../drizzle/schema";
import fs from "fs";
import path from "path";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }
  const allEv = await db.select().from(evidence);
  console.log("Total evidence count:", allEv.length);
  for (const e of allEv) {
    const filePath = e.filePath || "";
    const fileUrl = e.fileUrl || "";
    const name = path.basename(fileUrl || filePath);
    const uploadsEvidencePath = path.resolve(process.cwd(), "uploads", "evidence", name);
    const uploadsDirectPath = path.resolve(process.cwd(), "uploads", name);
    const exists = fs.existsSync(uploadsEvidencePath) || fs.existsSync(uploadsDirectPath);
    console.log(`[${e.id}] Code: ${e.evidenceCode} | Proj: ${e.projectCode} | Cat: ${e.category} | Active: ${e.isActive} | FilePath: ${filePath} | FileUrl: ${fileUrl} | Exists: ${exists}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
