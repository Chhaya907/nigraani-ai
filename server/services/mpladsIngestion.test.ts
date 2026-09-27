import { describe, it, expect } from "vitest";
import {
  validateOfficialMpladsRecord,
  normalizeStatus,
  parseOfficialCsv,
  RawMpladsRecord,
} from "./mpladsIngestion";

describe("MPLADS Ingestion Unit Tests", () => {
  it("validates a compliant official MPLADS record successfully", () => {
    const validRecord: RawMpladsRecord = {
      work_id: "MPLAD-2025-001",
      work_name: "Integrated drinking water network",
      state_name: "Madhya Pradesh",
      district_name: "Barwani",
      sanctioned_amount_inr: 12400000,
      expenditure_amount_inr: 9424000,
      work_status: "Delayed",
    };

    const result = validateOfficialMpladsRecord(validRecord);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects records missing mandatory official work_id", () => {
    const invalidRecord: RawMpladsRecord = {
      work_name: "Hospital extension",
      state_name: "Maharashtra",
      district_name: "Wardha",
      sanctioned_amount_inr: 500000,
    };

    const result = validateOfficialMpladsRecord(invalidRecord);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Missing mandatory official work_id");
  });

  it("rejects records with invalid negative financial values", () => {
    const invalidRecord: RawMpladsRecord = {
      work_id: "MPLAD-2025-999",
      work_name: "Negative budget project",
      state_name: "Kerala",
      district_name: "Kottayam",
      sanctioned_amount_inr: -100000,
    };

    const result = validateOfficialMpladsRecord(invalidRecord);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid sanctioned_amount_inr");
  });

  it("normalizes official status variations correctly", () => {
    expect(normalizeStatus("Completed")).toBe("Completed");
    expect(normalizeStatus("Work Finished")).toBe("Completed");
    expect(normalizeStatus("Delayed")).toBe("Delayed");
    expect(normalizeStatus("Sanctioned")).toBe("Sanctioned");
    expect(normalizeStatus("Recommended")).toBe("Recommended");
    expect(normalizeStatus("In Progress")).toBe("Active");
    expect(normalizeStatus(undefined)).toBe("Active");
  });

  it("correctly parses official CSV records with quoted comma fields", () => {
    const sampleCsv = `work_id,work_name,work_description,state_name,district_name,sanctioned_amount_inr
MPLAD-TEST-01,"Road, Culvert and Drainage","Construction of 2.4 km road, drainage",Maharashtra,Wardha,5000000`;

    const records = parseOfficialCsv(sampleCsv);
    expect(records.length).toBe(1);
    expect(records[0].work_id).toBe("MPLAD-TEST-01");
    expect(records[0].work_name).toBe("Road, Culvert and Drainage");
    expect(records[0].district_name).toBe("Wardha");
  });
});
