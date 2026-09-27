import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  projects,
  expenditures,
  projectUpdates,
  evidence,
  auditLogs,
  InsertProjectUpdate,
  InsertExpenditure,
  InsertEvidence,
  InsertAuditLog,
} from "../../drizzle/schema";
import { nanoid } from "nanoid";

export interface DemoAugmentationSummary {
  projectUpdatesAdded: number;
  expendituresAdded: number;
  evidenceItemsAdded: number;
  auditLogsAdded: number;
}

/**
 * Seeds execution-level telemetry (updates, milestone expenditures, photo evidence)
 * that is not available in official public MPLADS portal data.
 *
 * Strict Compliance:
 * - Marked explicitly as DEMO_AUGMENTATION.
 * - Never overwrites OFFICIAL_PUBLIC data.
 * - Deterministic and idempotent (no duplicates on re-runs).
 * - Full audit trail recorded.
 */
export async function seedDemoAugmentation(): Promise<DemoAugmentationSummary> {
  const db = await getDb();
  if (!db) {
    throw new Error("[Demo Augmentation] Database connection unavailable");
  }

  const allProjects = await db.select().from(projects);
  if (allProjects.length === 0) {
    throw new Error("[Demo Augmentation] No official projects found. Run official ingestion first.");
  }

  const projMap = new Map(allProjects.map(p => [p.projectCode, p]));

  // 1. Operational Updates (Progress Telemetry)
  // Clean up any existing demo augmentation updates to ensure idempotency
  await db.delete(projectUpdates).where(eq(projectUpdates.sourceType, "DEMO_AUGMENTATION"));

  const updatesData: InsertProjectUpdate[] = [
    {
      projectId: projMap.get("MPLAD-2025-001")?.id || 1,
      projectCode: "MPLAD-2025-001",
      updatedBy: "District Collectorate, Barwani",
      role: "district",
      updateType: "PROGRESS_INSPECTION",
      previousProgress: 35,
      newProgress: 65,
      remarks: "Overhead tank masonry complete; pipeline distribution network under progress in Pati block.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-03-10T10:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-014")?.id || 2,
      projectCode: "MPLAD-2025-014",
      updatedBy: "District Executive Engineer, Wardha",
      role: "district",
      updateType: "MILESTONE_UPDATE",
      previousProgress: 20,
      newProgress: 39,
      remarks: "Classroom structural framing erected; science lab electrification pending contractor deployment.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-02-15T11:30:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-035")?.id || 3,
      projectCode: "MPLAD-2025-035",
      updatedBy: "Municipal Corporation, Srinagar",
      role: "district",
      updateType: "OBSTRUCTION_DELAY",
      previousProgress: 20,
      newProgress: 35,
      remarks: "Canal desiltation partially completed; work suspended due to seasonal waterlogging.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-01-20T09:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-044")?.id || 4,
      projectCode: "MPLAD-2025-044",
      updatedBy: "Medical Officer In-Charge, Kottayam",
      role: "district",
      updateType: "PROGRESS_INSPECTION",
      previousProgress: 15,
      newProgress: 32,
      remarks: "Solar rooftop mount rails completed; digital X-ray shipment awaiting customs clearance.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-03-01T14:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-052")?.id || 5,
      projectCode: "MPLAD-2025-052",
      updatedBy: "PWD Rural Works, Pune",
      role: "district",
      updateType: "FINAL_COMPLETION",
      previousProgress: 80,
      newProgress: 100,
      remarks: "2.4 km bitumen macadam road and retaining wall completed. Certified by Quality Control wing.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-02-28T16:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-061")?.id || 6,
      projectCode: "MPLAD-2025-061",
      updatedBy: "District Education Officer, Srinagar",
      role: "district",
      updateType: "FINAL_COMPLETION",
      previousProgress: 75,
      newProgress: 100,
      remarks: "Library building furnished, 20 computer terminals commissioned, open for public reading.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-01-15T12:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-073")?.id || 7,
      projectCode: "MPLAD-2025-073",
      updatedBy: "Gram Panchayat Secretary, Dhar",
      role: "district",
      updateType: "PROGRESS_INSPECTION",
      previousProgress: 30,
      newProgress: 59,
      remarks: "Roof truss placed and boundary wall erected. Flooring materials arrived on site.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-03-05T10:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-088")?.id || 8,
      projectCode: "MPLAD-2025-088",
      updatedBy: "State Renewable Energy Agency, Barwani",
      role: "state",
      updateType: "FINAL_COMPLETION",
      previousProgress: 70,
      newProgress: 100,
      remarks: "All 12 remote tribal settlements electrified via 50kW solar microgrid with battery storage.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-02-10T15:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-095")?.id || 9,
      projectCode: "MPLAD-2025-095",
      updatedBy: "Sanitation Division, Wardha",
      role: "district",
      updateType: "SLOW_PROGRESS",
      previousProgress: 10,
      newProgress: 21,
      remarks: "Excavation delayed due to hard rock strata. Contractor seeking revised blasting approval.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-01-10T11:00:00Z"),
    },
    {
      projectId: projMap.get("MPLAD-2025-102")?.id || 10,
      projectCode: "MPLAD-2025-102",
      updatedBy: "Animal Husbandry Officer, Barwani",
      role: "district",
      updateType: "INITIAL_STAGE",
      previousProgress: 5,
      newProgress: 17,
      remarks: "Foundation masonry completed. Superstructure plinth work in progress.",
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-02-20T10:30:00Z"),
    },
  ];

  await db.insert(projectUpdates).values(updatesData);

  // 2. Granular Milestone Expenditures (Disbursement Trajectories for Isolation Forest)
  await db.delete(expenditures).where(eq(expenditures.sourceType, "DEMO_AUGMENTATION"));

  const expendituresData: InsertExpenditure[] = [
    // MPLAD-2025-001 (Multi-installment pipeline progress)
    {
      projectId: projMap.get("MPLAD-2025-001")?.id || 1,
      projectCode: "MPLAD-2025-001",
      voucherNo: "BAR/MPLAD/2024-25/V-105",
      disbursementDate: new Date("2024-11-20T00:00:00Z"),
      amount: 4200000,
      purpose: "Civil masonry and overhead reservoir tank construction installment 2",
      recipientAgency: "PHED Construction Division, Barwani",
      utilizationCertificateStatus: "Submitted",
      sourceType: "DEMO_AUGMENTATION",
    },
    {
      projectId: projMap.get("MPLAD-2025-001")?.id || 1,
      projectCode: "MPLAD-2025-001",
      voucherNo: "BAR/MPLAD/2024-25/V-106",
      disbursementDate: new Date("2025-02-10T00:00:00Z"),
      amount: 2500000,
      purpose: "Reverse osmosis water treatment membranes and pump delivery",
      recipientAgency: "HydroTech Clean Water Solutions",
      utilizationCertificateStatus: "Pending",
      sourceType: "DEMO_AUGMENTATION",
    },

    // MPLAD-2025-014 (School upgrade installments)
    {
      projectId: projMap.get("MPLAD-2025-014")?.id || 2,
      projectCode: "MPLAD-2025-014",
      voucherNo: "WRD/MPLAD/SAN/2024/V-482",
      disbursementDate: new Date("2024-12-15T00:00:00Z"),
      amount: 1400000,
      purpose: "Smart classroom construction milestone 1",
      recipientAgency: "PWD Division II, Wardha",
      utilizationCertificateStatus: "Submitted",
      sourceType: "DEMO_AUGMENTATION",
    },

    // MPLAD-2025-044 (Health centre equipment)
    {
      projectId: projMap.get("MPLAD-2025-044")?.id || 4,
      projectCode: "MPLAD-2025-044",
      voucherNo: "KTM/COL/MPLAD/24-25/V-091",
      disbursementDate: new Date("2025-01-10T00:00:00Z"),
      amount: 800000,
      purpose: "10kW solar battery storage bank installation",
      recipientAgency: "Kerala State Electronics Development Corp",
      utilizationCertificateStatus: "Submitted",
      sourceType: "DEMO_AUGMENTATION",
    },

    // MPLAD-2025-073 (Community hall installments)
    {
      projectId: projMap.get("MPLAD-2025-073")?.id || 7,
      projectCode: "MPLAD-2025-073",
      voucherNo: "DHR/MPLAD/24-25/V-201",
      disbursementDate: new Date("2024-11-30T00:00:00Z"),
      amount: 1850000,
      purpose: "Roof truss and column construction milestone",
      recipientAgency: "Rural Infrastructure Directorate, Dhar",
      utilizationCertificateStatus: "Submitted",
      sourceType: "DEMO_AUGMENTATION",
    },

    // MPLAD-2025-095 (Abnormal rapid lump-sum disbursement - Outlier for Isolation Forest)
    {
      projectId: projMap.get("MPLAD-2025-095")?.id || 9,
      projectCode: "MPLAD-2025-095",
      voucherNo: "WRD/MPLAD/SAN/2024/V-999-ANOM",
      disbursementDate: new Date("2024-12-28T00:00:00Z"),
      amount: 5500000,
      purpose: "Disproportionate lump-sum advance payment for pipeline laying without certified measurement book",
      recipientAgency: "Apex Infra Private Limited",
      utilizationCertificateStatus: "Overdue",
      sourceType: "DEMO_AUGMENTATION",
    },
  ];

  await db.insert(expenditures).values(expendituresData);

  // 3. Photographic Evidence with Perceptual Hashes (Image Similarity Module)
  await db.delete(evidence).where(eq(evidence.sourceType, "DEMO_AUGMENTATION"));

  // Note: We deliberately create a verified pair with matching perceptual hashes
  // between MPLAD-2025-035 (Srinagar Drainage) and MPLAD-2025-095 (Wardha Sewerage)
  // to represent real-world evidence reuse across jurisdictions!
  const evidenceData: InsertEvidence[] = [
    {
      evidenceCode: "EVID-MPLAD-001-01",
      projectId: projMap.get("MPLAD-2025-001")?.id || 1,
      projectCode: "MPLAD-2025-001",
      title: "Overhead Reservoir Foundation Inspection Photo",
      category: "Site Inspection Photo",
      filePath: "/evidence/2025/001/tank_foundation_20250110.jpg",
      fileUrl: "https://mplads.gov.in/evidence/001_tank_foundation.jpg",
      fileSize: 2458900,
      mimeType: "image/jpeg",
      perceptualHash: "f8f0e0c080000000",
      uploadedBy: "P. Yadav (District Authority)",
      uploadedRole: "district",
      verified: true,
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-01-10T11:00:00Z"),
    },
    {
      evidenceCode: "EVID-MPLAD-014-01",
      projectId: projMap.get("MPLAD-2025-014")?.id || 2,
      projectCode: "MPLAD-2025-014",
      title: "Classroom Structural Framing Progress",
      category: "Milestone Photo",
      filePath: "/evidence/2025/014/classroom_framing.jpg",
      fileUrl: "https://mplads.gov.in/evidence/014_classroom.jpg",
      fileSize: 3120400,
      mimeType: "image/jpeg",
      perceptualHash: "aa55aa55aa55aa55",
      uploadedBy: "N. Patil (Executing Agency)",
      uploadedRole: "district",
      verified: true,
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-02-15T12:00:00Z"),
    },
    {
      evidenceCode: "EVID-MPLAD-035-01",
      projectId: projMap.get("MPLAD-2025-035")?.id || 3,
      projectCode: "MPLAD-2025-035",
      title: "Storm-water Drainage Trench Excavation Verification",
      category: "Site Inspection Photo",
      filePath: "/evidence/2025/035/drainage_trench_srinagar.jpg",
      fileUrl: "https://mplads.gov.in/evidence/035_drainage_trench.jpg",
      fileSize: 2894100,
      mimeType: "image/jpeg",
      // Canonical hash for this drainage excavation photo
      perceptualHash: "3c3c3c3c3c3c3c3c",
      uploadedBy: "A. M. Lone (District Engineer)",
      uploadedRole: "district",
      verified: true,
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-01-18T10:00:00Z"),
    },
    {
      evidenceCode: "EVID-MPLAD-052-01",
      projectId: projMap.get("MPLAD-2025-052")?.id || 5,
      projectCode: "MPLAD-2025-052",
      title: "Completed All-Weather Bitumen Road Section",
      category: "Completion Photo",
      filePath: "/evidence/2025/052/completed_road.jpg",
      fileUrl: "https://mplads.gov.in/evidence/052_road.jpg",
      fileSize: 4210900,
      mimeType: "image/jpeg",
      perceptualHash: "0000ffff0000ffff",
      uploadedBy: "R. Menon (State Nodal Official)",
      uploadedRole: "state",
      verified: true,
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-02-28T16:30:00Z"),
    },
    {
      evidenceCode: "EVID-MPLAD-073-01",
      projectId: projMap.get("MPLAD-2025-073")?.id || 7,
      projectCode: "MPLAD-2025-073",
      title: "Community Hall Steel Truss Erection",
      category: "Milestone Photo",
      filePath: "/evidence/2025/073/hall_truss.jpg",
      fileUrl: "https://mplads.gov.in/evidence/073_hall_truss.jpg",
      fileSize: 3450000,
      mimeType: "image/jpeg",
      perceptualHash: "00ff00ff00ff00ff",
      uploadedBy: "P. Yadav (District Authority)",
      uploadedRole: "district",
      verified: true,
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-03-05T11:00:00Z"),
    },
    {
      evidenceCode: "EVID-MPLAD-095-01",
      projectId: projMap.get("MPLAD-2025-095")?.id || 9,
      projectCode: "MPLAD-2025-095",
      title: "Sewerage Pipe Trench Excavation Photo",
      category: "Site Inspection Photo",
      filePath: "/evidence/2025/095/sewerage_trench_wardha.jpg",
      fileUrl: "https://mplads.gov.in/evidence/095_sewerage_trench.jpg",
      fileSize: 2894100,
      mimeType: "image/jpeg",
      // MATCHING HASH: Exact duplicate (Hamming distance = 0) of EVID-MPLAD-035-01!
      perceptualHash: "3c3c3c3c3c3c3c3c",
      uploadedBy: "Wardha Contractor Agency",
      uploadedRole: "district",
      verified: false,
      sourceType: "DEMO_AUGMENTATION",
      createdAt: new Date("2025-03-08T15:00:00Z"),
    },
  ];

  await db.insert(evidence).values(evidenceData);

  // 4. Audit Log Entry for Provenance of Demo Augmentation
  const auditData: InsertAuditLog = {
    auditCode: `AUD-AUG-${nanoid(8).toUpperCase()}`,
    userName: "System Initializer",
    userRole: "mospi",
    action: "DEMO_AUGMENTATION_APPLIED",
    targetId: "ALL_PROJECTS",
    targetType: "system",
    fieldChanged: "telemetry",
    oldValue: null,
    newValue: JSON.stringify({
      sourceType: "DEMO_AUGMENTATION",
      updatesCount: updatesData.length,
      expendituresCount: expendituresData.length,
      evidenceCount: evidenceData.length,
    }),
    comments: "Applied execution-level demo telemetry for AI evaluation (progress updates, multi-voucher disbursements, and perceptual image hashes)",
    sourceType: "DEMO_AUGMENTATION",
  };
  await db.insert(auditLogs).values(auditData);

  return {
    projectUpdatesAdded: updatesData.length,
    expendituresAdded: expendituresData.length,
    evidenceItemsAdded: evidenceData.length,
    auditLogsAdded: 1,
  };
}
