import { describe, it, expect } from "vitest";
import { semanticSimilarityEngine, SemanticProjectInput } from "./embedding";
import { isolationForestEngine, cFactor } from "./isolationForest";
import { randomForestEngine, DELAY_FEATURE_NAMES } from "./randomForest";
import { perceptualHashEngine } from "./perceptualHash";
import { calculateCompositeRiskScore } from "../services/anomalyService";

describe("STEP 3: Genuine Machine Learning Models Verification", () => {
  // ---------------------------------------------------------------------------
  // MODEL 1: DUPLICATE WORK (SEMANTIC SIMILARITY) TESTS
  // ---------------------------------------------------------------------------
  describe("Model 1: Duplicate Work — Semantic Similarity", () => {
    it("1. generates deterministic dense embedding vectors with unit L2 norm", () => {
      const text = "Installation of drinking water pipeline and community reverse osmosis filtration plant in Barwani.";
      const emb1 = semanticSimilarityEngine.generateEmbedding(text);
      const emb2 = semanticSimilarityEngine.generateEmbedding(text);

      expect(emb1.length).toBe(128);
      // Deterministic check
      expect(Array.from(emb1)).toEqual(Array.from(emb2));

      // L2 norm check: ||v||_2 = 1.0
      let sumSq = 0;
      for (let i = 0; i < emb1.length; i++) sumSq += emb1[i] * emb1[i];
      expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 4);
    });

    it("2. calculates exact cosine similarity between vector embeddings", () => {
      const vA = new Float64Array([1, 0, 0]);
      const vB = new Float64Array([0, 1, 0]);
      const vSame = new Float64Array([1, 0, 0]);

      // Orthogonal vectors should have 0 similarity
      expect(semanticSimilarityEngine.cosineSimilarity(vA, vB)).toBe(0);
      // Identical unit vectors should have 1.0 similarity
      expect(semanticSimilarityEngine.cosineSimilarity(vA, vSame)).toBe(1.0);
    });

    it("3. produces significantly higher cosine similarity for similar projects than unrelated projects", () => {
      const projWater1: SemanticProjectInput = {
        projectCode: "MPLAD-2025-001",
        title: "Integrated drinking water network and community filtration plant",
        description: "Installation of piped drinking water distribution network, 50,000 litre overhead tank, and community reverse osmosis filtration unit.",
        district: "Barwani",
        state: "Madhya Pradesh",
        category: "Drinking Water",
      };

      const projWater2: SemanticProjectInput = {
        projectCode: "MPLAD-2025-001-B",
        title: "Community drinking water distribution and RO filtration system",
        description: "Construction of piped drinking water network, overhead storage reservoir, and RO filtration plant.",
        district: "Barwani",
        state: "Madhya Pradesh",
        category: "Drinking Water",
      };

      const projRoad: SemanticProjectInput = {
        projectCode: "MPLAD-2025-052",
        title: "Rural connectivity road with protective retaining wall in hilly terrain",
        description: "Construction of 2.4 km bitumen macadam all-weather road connecting isolated tribal hamlets with block headquarters.",
        district: "Pune",
        state: "Maharashtra",
        category: "Roads & Pathways",
      };

      const resSimilar = semanticSimilarityEngine.comparePair(projWater1, projWater2);
      const resUnrelated = semanticSimilarityEngine.comparePair(projWater1, projRoad);

      expect(resSimilar.score).toBeGreaterThan(resUnrelated.score);
      expect(resSimilar.score).toBeGreaterThan(0.65);
      expect(resSimilar.isAnomaly).toBe(true);
      expect(resSimilar.status).toBe("POTENTIAL_ANOMALY");
      expect(resSimilar.sameDistrict).toBe(true);
      expect(resSimilar.explanation).toContain("high semantic similarity");

      expect(resUnrelated.score).toBeLessThan(0.60);
      expect(resUnrelated.isAnomaly).toBe(false);
      expect(resUnrelated.status).toBe("NORMAL");
    });
  });

  // ---------------------------------------------------------------------------
  // MODEL 2: FUND MOVEMENT (ISOLATION FOREST) TESTS
  // ---------------------------------------------------------------------------
  describe("Model 2: Fund Movement — Isolation Forest", () => {
    it("4. verifies BST average path length factor c(n) follows theoretical formulation", () => {
      // c(1) = 0, c(2) = 1
      expect(cFactor(1)).toBe(0);
      expect(cFactor(2)).toBe(1);
      // For n = 32, c(n) ~ 2*(ln(31) + 0.5772) - 2*31/32 ~ 2*(3.434 + 0.5772) - 1.9375 ~ 6.08
      const c32 = cFactor(32);
      expect(c32).toBeGreaterThan(5.5);
      expect(c32).toBeLessThan(6.5);
    });

    it("5. isolation forest identifies abnormal disbursement outliers and calculates anomaly scores", () => {
      // Outlier: 99% spent immediately with a single massive voucher
      const outlierFeatures = [10000000, 9900000, 0.99, 4950000, 1, 9900000];
      const normalFeatures = [6000000, 3600000, 0.60, 450000, 5, 720000];

      const scoreOutlier = isolationForestEngine.computeAnomalyScore(outlierFeatures);
      const scoreNormal = isolationForestEngine.computeAnomalyScore(normalFeatures);

      expect(scoreOutlier).toBeGreaterThan(scoreNormal);
      expect(scoreOutlier).toBeGreaterThan(0.60);
    });

    it("6. honestly declares INSUFFICIENT_DATA when granular transaction history is absent", () => {
      const officialProject = {
        projectCode: "MPLAD-2025-001",
        sanctionedAmount: 12400000,
        spentAmount: 9424000,
      };

      // In official public base data, only single aggregate expenditure is recorded (length = 1)
      const singleDisbursement = [{ amount: 9424000, voucherNo: "BAR/MPLAD/2024-25/W-104" }];

      const result = isolationForestEngine.predict(officialProject, singleDisbursement);
      expect(result.status).toBe("INSUFFICIENT_DATA");
      expect(result.isAnomaly).toBe(false);
      expect(result.explanation).toContain("Insufficient transaction frequency");
      expect(result.features).toBeNull();
    });

    it("7. evaluates multi-voucher operational trajectory correctly when updates exist", () => {
      const multiVoucherProject = {
        projectCode: "MPLAD-MULTI-01",
        sanctionedAmount: 5000000,
        spentAmount: 4900000,
      };
      const vouchers = [
        { amount: 2500000, voucherNo: "V-1" },
        { amount: 2400000, voucherNo: "V-2" },
      ];

      const result = isolationForestEngine.predict(multiVoucherProject, vouchers);
      expect(result.status).not.toBe("INSUFFICIENT_DATA");
      expect(result.features).toBeDefined();
      expect(result.features?.voucherCount).toBe(2);
      expect(result.topDriver).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // MODEL 3: DELAY RISK (RANDOM FOREST) TESTS
  // ---------------------------------------------------------------------------
  describe("Model 3: Delay Risk — Random Forest", () => {
    it("8. trains Random Forest and computes genuine Mean Decrease in Impurity (MDI) feature importances", () => {
      expect(randomForestEngine.isTrained).toBe(true);
      const importances = randomForestEngine.getFeatureImportances();

      // All 6 features must have computed importances
      for (const feat of DELAY_FEATURE_NAMES) {
        expect(importances[feat]).toBeDefined();
        expect(importances[feat]).toBeGreaterThan(0);
      }

      // Sum of MDI feature importances must equal 1.0 (within rounding)
      const totalImp = Object.values(importances).reduce((acc, v) => acc + v, 0);
      expect(totalImp).toBeCloseTo(1.0, 2);
    });

    it("9. predicts ON_TIME vs DELAYED classes with confidence probabilities", () => {
      const onTimeProject = {
        projectCode: "PROJ-FAST",
        status: "Active",
        progress: 95,
        sanctionedAmount: 10000000,
        spentAmount: 9000000,
        startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 180 days ago
      };
      const resOnTime = randomForestEngine.predict(onTimeProject, [{ newProgress: 95 }]);
      expect(resOnTime.predictedClass).toBe("ON_TIME");
      expect(resOnTime.confidence).toBeGreaterThan(0.5);
      expect(resOnTime.isAnomaly).toBe(false);

      const delayedProject = {
        projectCode: "PROJ-SLOW",
        status: "Delayed",
        progress: 10,
        sanctionedAmount: 10000000,
        spentAmount: 8500000, // 85% spent but only 10% progress after 300 days
        startDate: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000),
      };
      const resDelayed = randomForestEngine.predict(delayedProject, [{ newProgress: 10 }]);
      expect(["DELAYED", "AT_RISK"]).toContain(resDelayed.predictedClass);
      expect(resDelayed.isAnomaly).toBe(true);
      expect(resDelayed.explanation).toContain("Low progress velocity");
    });

    it("10. honestly declares INSUFFICIENT_DATA if progress percentage is completely unknown", () => {
      const unmonitoredProject = {
        projectCode: "PROJ-UNKNOWN",
        status: "Active",
        progress: null as any,
        sanctionedAmount: 5000000,
        spentAmount: 1000000,
      };

      const result = randomForestEngine.predict(unmonitoredProject, []);
      expect(result.status).toBe("INSUFFICIENT_DATA");
      expect(result.predictedClass).toBe("UNKNOWN");
      expect(result.isAnomaly).toBe(false);
      expect(result.explanation).toContain("Insufficient execution telemetry");
    });
  });

  // ---------------------------------------------------------------------------
  // MODEL 4: EVIDENCE REUSE (PERCEPTUAL HASHING) TESTS
  // ---------------------------------------------------------------------------
  describe("Model 4: Evidence Reuse — Image Similarity", () => {
    it("11. calculates bitwise Hamming distance correctly", () => {
      const hA = "ffff0000ffff0000";
      const hSame = "ffff0000ffff0000";
      const h1BitDiff = "ffff0000ffff0001"; // '0' (0000) vs '1' (0001) -> 1 bit difference
      const hOpposite = "0000ffff0000ffff"; // all 64 bits flipped

      expect(perceptualHashEngine.calculateHammingDistance(hA, hSame)).toBe(0);
      expect(perceptualHashEngine.calculateHammingDistance(hA, h1BitDiff)).toBe(1);
      expect(perceptualHashEngine.calculateHammingDistance(hA, hOpposite)).toBe(64);
    });

    it("12. flags perceptual hash matches with small Hamming distance as potential photo reuse", () => {
      const targetEvidence = {
        evidenceCode: "EV-2026-001",
        projectCode: "MPLAD-2025-001",
        title: "Site excavation and foundation trench inspection",
        perceptualHash: "a4f8e239c011bb28",
      };

      const corpus = [
        {
          evidenceCode: "EV-2025-999",
          projectCode: "MPLAD-2024-888", // Cross-project match!
          title: "Foundation trench work in Wardha",
          perceptualHash: "a4f8e239c011bb29", // Hamming distance = 1 bit (virtually identical image)
        },
        {
          evidenceCode: "EV-2025-102",
          projectCode: "MPLAD-2025-102",
          title: "Veterinary clinic site boundary",
          perceptualHash: "1122334455667788", // Distinct hash
        },
      ];

      const res = perceptualHashEngine.scanForReuse(targetEvidence, corpus);
      expect(res.status).toBe("POTENTIAL_ANOMALY");
      expect(res.isAnomaly).toBe(true);
      expect(res.hammingDistance).toBe(1);
      expect(res.score).toBeGreaterThan(0.95);
      expect(res.crossProject).toBe(true);
      expect(res.explanation).toContain("Potential evidence image reuse detected");
    });

    it("13. honestly declares INSUFFICIENT_DATA when comparison corpus is empty", () => {
      const targetEvidence = {
        evidenceCode: "EV-FIRST",
        projectCode: "MPLAD-2025-001",
        title: "First site photo",
        perceptualHash: "a4f8e239c011bb28",
      };

      const res = perceptualHashEngine.scanForReuse(targetEvidence, []);
      expect(res.status).toBe("INSUFFICIENT_DATA");
      expect(res.isAnomaly).toBe(false);
      expect(res.explanation).toContain("No prior photographic evidence exists");
    });
  });

  // ---------------------------------------------------------------------------
  // COMPOSITE RISK SCORE & DETERMINISM TESTS
  // ---------------------------------------------------------------------------
  describe("Composite Risk Score Determinism", () => {
    it("14. calculates composite risk score deterministically without Math.random", () => {
      // 30% dup, 25% fund, 25% delay, 20% reuse
      const r1 = calculateCompositeRiskScore(0.80, 0.70, 0.80, 0.90);
      const r2 = calculateCompositeRiskScore(0.80, 0.70, 0.80, 0.90);

      // (0.80*30) + (0.70*25) + (0.80*25) + (0.90*20) = 24 + 17.5 + 20 + 18 = 79.5 -> 80
      expect(r1.compositeScore).toBe(80);
      expect(r1.riskLevel).toBe("High");
      expect(r1.compositeScore).toBe(r2.compositeScore); // Exactly reproducible
    });

    it("15. respects prototype risk bands: 0-30 Low, 31-70 Medium, 71-100 High", () => {
      expect(calculateCompositeRiskScore(0.1, 0.1, 0.1, 0.1).riskLevel).toBe("Low");
      expect(calculateCompositeRiskScore(0.5, 0.5, 0.5, 0.5).riskLevel).toBe("Medium");
      expect(calculateCompositeRiskScore(0.9, 0.9, 0.9, 0.9).riskLevel).toBe("High");
    });
  });
});
