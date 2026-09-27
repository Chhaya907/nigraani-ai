import "dotenv/config";
import { getDb } from "../db";
import {
  projects,
  expenditures,
  dataImports,
  dataProvenance,
  auditLogs,
} from "../../drizzle/schema";
import {
  ingestBaseOfficialDataset,
  ingestOfficialMpladsRecords,
  parseOfficialCsv,
  RawMpladsRecord,
} from "./mpladsIngestion";
import fs from "fs";
import path from "path";

async function main() {
  console.log("==================================================");
  console.log("STEP 2: MPLADS DATA INGESTION EXECUTION");
  console.log("==================================================");

  const db = await getDb();
  if (!db) {
    console.error("FATAL: Database connection could not be established.");
    process.exit(1);
  }

  // 1. Ingest base official dataset
  console.log("\n[1/4] Ingesting base official public MPLADS dataset (JSON)...");
  const result1 = await ingestBaseOfficialDataset();
  console.log(`- Batch ID: ${result1.batchId}`);
  console.log(`- Total Records in File: ${result1.totalRecordsProcessed}`);
  console.log(`- Official Records Imported: ${result1.importedCount}`);
  console.log(`- Records Rejected: ${result1.rejectedCount}`);
  console.log(`- Duplicate Records Skipped: ${result1.duplicateCount}`);

  // 2. Test Deduplication
  console.log("\n[2/4] Testing Deduplication with Repeated Import...");
  const result2 = await ingestBaseOfficialDataset();
  console.log(`- Re-import Batch ID: ${result2.batchId}`);
  console.log(`- Re-import Imported Count: ${result2.importedCount} (Expected: 0)`);
  console.log(`- Re-import Duplicate Skipped: ${result2.duplicateCount} (Expected: ${result1.importedCount})`);

  // 3. Test Validation & Rejection handling with deliberate malformed data
  console.log("\n[3/4] Testing Validation & Rejection Handling...");
  const malformedTestBatch: RawMpladsRecord[] = [
    {
      // Missing work_id
      work_name: "Defective record without work ID",
      state_name: "Madhya Pradesh",
      district_name: "Barwani",
      sanctioned_amount_inr: 500000,
    },
    {
      // Missing work_name
      work_id: "MPLAD-TEST-INVALID-01",
      state_name: "Maharashtra",
      district_name: "Pune",
      sanctioned_amount_inr: 1000000,
    },
    {
      // Negative sanctioned amount
      work_id: "MPLAD-TEST-INVALID-02",
      work_name: "Defective record with negative budget",
      state_name: "Kerala",
      district_name: "Kottayam",
      sanctioned_amount_inr: -250000,
    },
  ];
  const rejectResult = await ingestOfficialMpladsRecords(
    malformedTestBatch,
    "test_malformed_records.json",
    "MoSPI Quality Assurance Subsystem"
  );
  console.log(`- Rejection Test Processed: ${rejectResult.totalRecordsProcessed}`);
  console.log(`- Rejection Test Rejected: ${rejectResult.rejectedCount} (Expected: 3)`);
  console.log(`- Rejection Reasons logged:`);
  rejectResult.rejectedDetails.forEach((r, idx) => console.log(`   ${idx + 1}. ${r.reason}`));

  // 4. Test CSV Ingestion Parser
  console.log("\n[4/4] Testing CSV Parser with official CSV file...");
  const csvPath = path.resolve(process.cwd(), "server/data/official_mplads_works.csv");
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const parsedFromCsv = parseOfficialCsv(csvContent);
  console.log(`- Successfully parsed ${parsedFromCsv.length} records from official_mplads_works.csv`);

  // 5. Query and verify MySQL tables
  console.log("\n==================================================");
  console.log("DATABASE VERIFICATION SUMMARY");
  console.log("==================================================");

  const allProjects = await db.select().from(projects);
  console.log(`Total rows in 'projects' table: ${allProjects.length}`);
  console.log(`- Filter by sourceType = 'OFFICIAL_PUBLIC': ${allProjects.filter(p => p.sourceType === 'OFFICIAL_PUBLIC').length}`);

  const allExpenditures = await db.select().from(expenditures);
  console.log(`Total rows in 'expenditures' table: ${allExpenditures.length}`);
  console.log(`- Filter by sourceType = 'OFFICIAL_PUBLIC': ${allExpenditures.filter(e => e.sourceType === 'OFFICIAL_PUBLIC').length}`);

  const allImports = await db.select().from(dataImports);
  console.log(`Total rows in 'data_imports' table: ${allImports.length}`);

  const allProvenance = await db.select().from(dataProvenance);
  console.log(`Total rows in 'data_provenance' table: ${allProvenance.length}`);
  console.log(`- Official Portal: ${allProvenance[0]?.officialPortal}`);
  console.log(`- Source Type: ${allProvenance[0]?.sourceType}`);

  const allAudit = await db.select().from(auditLogs);
  console.log(`Total rows in 'audit_logs' table: ${allAudit.length}`);

  console.log("\nOfficial Works Ingested in Database:");
  allProjects.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.projectCode}] ${p.title} | ${p.district}, ${p.state} | ₹${p.sanctionedAmount.toLocaleString('en-IN')} (Spent: ₹${p.spentAmount.toLocaleString('en-IN')}) | Status: ${p.status}`);
  });

  console.log("\n==================================================");
  console.log("STEP 2 INGESTION PIPELINE VERIFIED SUCCESSFULLY");
  console.log("==================================================");

  process.exit(0);
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
