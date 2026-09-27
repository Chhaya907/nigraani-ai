import axios from "axios";

export const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:5001";

export interface DuplicatePairResponse {
  module: "DUPLICATE_WORK";
  model: string;
  modelVersion: string;
  projectA: string;
  projectB: string;
  score: number;
  threshold: number;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  isAnomaly: boolean;
  sameDistrict: boolean;
  explanation: string;
  matchedContext: {
    titleA?: string;
    titleB?: string;
    districtA?: string;
    districtB?: string;
  };
}

export interface DuplicateScanResponse {
  totalPairsScanned: number;
  anomalies: DuplicatePairResponse[];
}

export interface FundMovementResponse {
  module: "FUND_MOVEMENT";
  model: string;
  modelVersion: string;
  projectCode: string;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  score: number;
  threshold: number;
  isAnomaly: boolean;
  explanation: string;
  features?: Record<string, number> | null;
  topDriver?: string;
  trainingDataType: string;
}

export interface DelayRiskResponse {
  module: "DELAY_RISK";
  model: string;
  modelVersion: string;
  projectCode: string;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  predictedClass: "ON_TIME" | "AT_RISK" | "DELAYED" | "UNKNOWN";
  confidence: number;
  score: number;
  threshold: number;
  isAnomaly: boolean;
  explanation: string;
  probabilities?: Record<string, number>;
  featureImportances?: Record<string, number>;
  features?: Record<string, number>;
  trainingDataType: string;
}

export interface EvidenceReuseResponse {
  module: "EVIDENCE_REUSE";
  model: string;
  modelVersion: string;
  evidenceCode: string;
  projectCode: string;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  score: number;
  hammingDistance?: number;
  maxAllowedDistance?: number;
  isAnomaly: boolean;
  crossProject?: boolean;
  explanation: string;
  targetHash?: string;
  matchedEvidence?: {
    evidenceCode?: string;
    projectCode?: string;
    perceptualHash?: string;
    title?: string;
  } | null;
}

export interface HealthCheckResponse {
  status: string;
  service: string;
  version: string;
  models: Record<string, unknown>;
}

export class MlServiceClient {
  private baseUrl: string;

  constructor(baseUrl: string = ML_SERVICE_URL) {
    this.baseUrl = baseUrl;
  }

  async checkHealth(): Promise<HealthCheckResponse | null> {
    try {
      const res = await axios.get<HealthCheckResponse>(`${this.baseUrl}/health`, { timeout: 3000 });
      return res.data;
    } catch {
      return null;
    }
  }

  async predictDuplicate(projectA: Record<string, unknown>, projectB: Record<string, unknown>, threshold?: number): Promise<DuplicatePairResponse> {
    const res = await axios.post<DuplicatePairResponse>(`${this.baseUrl}/predict/duplicate`, {
      project_a: projectA,
      project_b: projectB,
      threshold: threshold ?? 0.75,
    }, { timeout: 15000 });
    return res.data;
  }

  async scanDuplicates(projects: Record<string, unknown>[], threshold?: number): Promise<DuplicateScanResponse> {
    const res = await axios.post<DuplicateScanResponse>(`${this.baseUrl}/scan/duplicates`, {
      projects,
      threshold: threshold ?? 0.75,
    }, { timeout: 30000 });
    return res.data;
  }

  async predictFundMovement(project: Record<string, unknown>, expenditures?: Record<string, unknown>[]): Promise<FundMovementResponse> {
    const res = await axios.post<FundMovementResponse>(`${this.baseUrl}/predict/fund-movement`, {
      project,
      expenditures: expenditures ?? [],
    }, { timeout: 10000 });
    return res.data;
  }

  async predictDelayRisk(project: Record<string, unknown>, operationalUpdates?: Record<string, unknown>[]): Promise<DelayRiskResponse> {
    const res = await axios.post<DelayRiskResponse>(`${this.baseUrl}/predict/delay-risk`, {
      project,
      operational_updates: operationalUpdates ?? [],
    }, { timeout: 10000 });
    return res.data;
  }

  async predictEvidenceReuse(targetEvidence: Record<string, unknown>, existingEvidenceCorpus: Record<string, unknown>[]): Promise<EvidenceReuseResponse> {
    const res = await axios.post<EvidenceReuseResponse>(`${this.baseUrl}/predict/evidence-reuse`, {
      target_evidence: targetEvidence,
      existing_evidence_corpus: existingEvidenceCorpus,
    }, { timeout: 10000 });
    return res.data;
  }

  async computeImageHash(imageBase64: string): Promise<{ perceptualHash: string; differenceHash: string; averageHash: string }> {
    const res = await axios.post<{ perceptualHash: string; differenceHash: string; averageHash: string }>(
      `${this.baseUrl}/compute/image-hash`,
      { image_base64: imageBase64 },
      { timeout: 10000 }
    );
    return res.data;
  }
}

export const mlClient = new MlServiceClient();
