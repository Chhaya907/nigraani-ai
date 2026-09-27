/**
 * Model 3: Delay Risk — Random Forest
 * Exact mathematical implementation of Breiman's Random Forest Classifier (Breiman, 2001).
 * 
 * Mathematical Formulation:
 * 1. Bagging (Bootstrap Aggregating): Draws B bootstrap samples S_b with replacement from training set.
 * 2. Random Feature Subspaces: At each split node, selects a random subset of m = floor(sqrt(M)) features.
 * 3. Gini Impurity Criterion:
 *    I_G(t) = 1 - sum_{k=1}^K p_k^2
 * 4. Mean Decrease in Impurity (MDI) Feature Importance:
 *    Imp(j) = sum_{trees} sum_{nodes on j} N_t * Delta I_G(t)
 *    Normalized such that sum_j Imp(j) = 1.0.
 * 5. Ensemble Probability Voting:
 *    P(y = k | x) = (1 / B) * sum_{b=1}^B P_b(y = k | x)
 * 6. Predicted Class:
 *    y_hat = argmax_k P(y = k | x)
 * 
 * Strict Data Provenance Rule:
 * Model is trained on clearly labelled DEMO_AUGMENTATION execution trajectories.
 * In production, it consumes OFFICIAL_PUBLIC + OPERATIONAL_UPDATE.
 * If execution telemetry is completely absent, it returns INSUFFICIENT_DATA.
 */

export type DelayClass = "ON_TIME" | "AT_RISK" | "DELAYED";

export interface DelayRiskFeatures {
  progressPct: number;
  elapsedDays: number;
  expenditureRatio: number;
  updateFrequencyDays: number;
  progressVelocity: number;
  milestonesCompletedRatio: number;
}

export interface DelayRiskResult {
  module: "DELAY_RISK";
  model: "Random Forest";
  modelVersion: "v1.0-rf100-MDI";
  projectCode: string;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  predictedClass: DelayClass | "UNKNOWN";
  confidence: number;
  score: number;
  threshold: number;
  isAnomaly: boolean;
  explanation: string;
  probabilities: Record<DelayClass, number>;
  featureImportances: Record<string, number>;
  features?: DelayRiskFeatures | null;
  trainingDataType: "DEMO_AUGMENTATION";
}

export const DELAY_FEATURE_NAMES = [
  "progressPct",
  "elapsedDays",
  "expenditureRatio",
  "updateFrequencyDays",
  "progressVelocity",
  "milestonesCompletedRatio",
] as const;

export const DELAY_CLASSES: DelayClass[] = ["ON_TIME", "AT_RISK", "DELAYED"];

interface DecisionNode {
  isLeaf: boolean;
  featureIndex?: number;
  splitThreshold?: number;
  left?: DecisionNode;
  right?: DecisionNode;
  classProbabilities: number[]; // [p_ontime, p_atrisk, p_delayed]
}

export class CartDecisionTree {
  public root: DecisionNode;
  private maxDepth: number;
  private minSamplesSplit: number;

  constructor(maxDepth: number = 5, minSamplesSplit: number = 2) {
    this.maxDepth = maxDepth;
    this.minSamplesSplit = minSamplesSplit;
    this.root = { isLeaf: true, classProbabilities: [0.33, 0.33, 0.33] };
  }

  public fit(
    X: number[][],
    y: number[],
    featureImportancesAcc: Float64Array,
    seed: number = 42
  ): void {
    this.root = this.growTree(X, y, 0, featureImportancesAcc, seed);
  }

  private calculateGini(y: number[]): number {
    const n = y.length;
    if (n === 0) return 0;
    const counts = [0, 0, 0];
    for (let i = 0; i < n; i++) counts[y[i]]++;
    let sumSq = 0;
    for (let c = 0; c < 3; c++) {
      const p = counts[c] / n;
      sumSq += p * p;
    }
    return 1.0 - sumSq;
  }

  private growTree(
    X: number[][],
    y: number[],
    depth: number,
    featureImportancesAcc: Float64Array,
    seed: number
  ): DecisionNode {
    const n = y.length;
    const counts = [0, 0, 0];
    for (let i = 0; i < n; i++) counts[y[i]]++;
    const classProbabilities = counts.map(c => n > 0 ? Number((c / n).toFixed(4)) : 0.33);

    // Stop conditions: pure node, max depth, or insufficient samples
    const currentGini = this.calculateGini(y);
    if (depth >= this.maxDepth || n < this.minSamplesSplit || currentGini === 0) {
      return { isLeaf: true, classProbabilities };
    }

    const numFeatures = X[0].length;
    // Select random subset of features: m = floor(sqrt(numFeatures))
    const m = Math.max(2, Math.floor(Math.sqrt(numFeatures)));
    const selectedFeatures: number[] = [];
    const pool = Array.from({ length: numFeatures }, (_, i) => i);

    for (let i = 0; i < m; i++) {
      const pickIdx = Math.abs(Math.imul(seed + depth * 19 + i * 7, 65537)) % pool.length;
      selectedFeatures.push(pool.splice(pickIdx, 1)[0]);
    }

    let bestGain = -1;
    let bestFeature = selectedFeatures[0];
    let bestSplit = 0;
    let bestLeftIndices: number[] = [];
    let bestRightIndices: number[] = [];

    for (const f of selectedFeatures) {
      // Find candidate splits
      const values = X.map(row => row[f]);
      values.sort((a, b) => a - b);

      for (let i = 0; i < values.length - 1; i++) {
        if (values[i] === values[i + 1]) continue;
        const candidate = (values[i] + values[i + 1]) / 2.0;

        const leftY: number[] = [];
        const rightY: number[] = [];
        const leftIdx: number[] = [];
        const rightIdx: number[] = [];

        for (let j = 0; j < n; j++) {
          if (X[j][f] <= candidate) {
            leftY.push(y[j]);
            leftIdx.push(j);
          } else {
            rightY.push(y[j]);
            rightIdx.push(j);
          }
        }

        if (leftY.length === 0 || rightY.length === 0) continue;

        // Gini gain
        const giniLeft = this.calculateGini(leftY);
        const giniRight = this.calculateGini(rightY);
        const gain = currentGini - ((leftY.length / n) * giniLeft + (rightY.length / n) * giniRight);

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestSplit = candidate;
          bestLeftIndices = leftIdx;
          bestRightIndices = rightIdx;
        }
      }
    }

    if (bestGain <= 0 || bestLeftIndices.length === 0 || bestRightIndices.length === 0) {
      return { isLeaf: true, classProbabilities };
    }

    // Accumulate MDI feature importance
    featureImportancesAcc[bestFeature] += n * bestGain;

    const leftX = bestLeftIndices.map(i => X[i]);
    const leftY = bestLeftIndices.map(i => y[i]);
    const rightX = bestRightIndices.map(i => X[i]);
    const rightY = bestRightIndices.map(i => y[i]);

    return {
      isLeaf: false,
      featureIndex: bestFeature,
      splitThreshold: bestSplit,
      classProbabilities,
      left: this.growTree(leftX, leftY, depth + 1, featureImportancesAcc, seed * 2 + 1),
      right: this.growTree(rightX, rightY, depth + 1, featureImportancesAcc, seed * 2 + 2),
    };
  }

  public predictProbabilities(x: number[], node: DecisionNode): number[] {
    if (node.isLeaf) {
      return node.classProbabilities;
    }
    const feat = node.featureIndex!;
    const thr = node.splitThreshold!;
    if (x[feat] <= thr) {
      return this.predictProbabilities(x, node.left!);
    } else {
      return this.predictProbabilities(x, node.right!);
    }
  }
}

export class RandomForestClassifierEngine {
  private numTrees: number;
  private trees: CartDecisionTree[] = [];
  private featureImportances: Record<string, number> = {};
  public isTrained: boolean = false;

  constructor(numTrees: number = 60) {
    this.numTrees = numTrees;
    this.trainOnDemoAugmentation();
  }

  /**
   * Trains Random Forest on clearly labelled DEMO_AUGMENTATION trajectories.
   */
  private trainOnDemoAugmentation(): void {
    const demoData: Array<[number[], number]> = [
      // ON_TIME records (label = 0)
      [[85, 180, 0.82, 14, 0.47, 0.85], 0],
      [[92, 210, 0.90, 10, 0.44, 0.90], 0],
      [[70, 150, 0.68, 15, 0.46, 0.70], 0],
      [[95, 200, 0.95, 12, 0.47, 0.95], 0],
      [[60, 120, 0.58, 14, 0.50, 0.60], 0],
      [[75, 160, 0.72, 18, 0.46, 0.75], 0],
      [[88, 190, 0.85, 11, 0.46, 0.88], 0],
      [[50, 100, 0.49, 15, 0.50, 0.50], 0],
      [[100, 220, 1.00, 10, 0.45, 1.00], 0],
      [[80, 170, 0.78, 14, 0.47, 0.80], 0],

      // AT_RISK records (label = 1)
      [[45, 160, 0.75, 35, 0.28, 0.40], 1],
      [[35, 140, 0.62, 40, 0.25, 0.30], 1],
      [[50, 190, 0.78, 32, 0.26, 0.45], 1],
      [[40, 155, 0.65, 38, 0.25, 0.35], 1],
      [[55, 210, 0.82, 30, 0.26, 0.50], 1],
      [[30, 130, 0.55, 42, 0.23, 0.25], 1],
      [[48, 185, 0.74, 34, 0.25, 0.42], 1],
      [[38, 150, 0.60, 36, 0.25, 0.32], 1],
      [[52, 200, 0.80, 31, 0.26, 0.48], 1],
      [[42, 170, 0.70, 37, 0.24, 0.38], 1],

      // DELAYED records (label = 2)
      [[15, 240, 0.85, 75, 0.06, 0.15], 2],
      [[20, 300, 0.76, 90, 0.06, 0.20], 2],
      [[10, 220, 0.90, 80, 0.04, 0.10], 2],
      [[25, 330, 0.88, 85, 0.07, 0.20], 2],
      [[18, 270, 0.82, 95, 0.06, 0.15], 2],
      [[12, 250, 0.70, 70, 0.04, 0.10], 2],
      [[22, 310, 0.84, 88, 0.07, 0.18], 2],
      [[14, 280, 0.79, 92, 0.05, 0.12], 2],
      [[28, 350, 0.92, 82, 0.08, 0.22], 2],
      [[16, 260, 0.75, 78, 0.06, 0.14], 2],
    ];

    const n = demoData.length;
    const numFeatures = DELAY_FEATURE_NAMES.length;
    const rawImportances = new Float64Array(numFeatures);
    this.trees = [];

    for (let b = 0; b < this.numTrees; b++) {
      // Bootstrap sample with replacement
      const bootX: number[][] = [];
      const bootY: number[] = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.abs(Math.imul(b * 73 + i * 29, 982451653)) % n;
        bootX.push(demoData[idx][0]);
        bootY.push(demoData[idx][1]);
      }

      const tree = new CartDecisionTree(5, 2);
      tree.fit(bootX, bootY, rawImportances, (b + 1) * 43);
      this.trees.push(tree);
    }

    // Normalize MDI feature importances to sum to 1.0
    let totalImp = 0;
    for (let i = 0; i < numFeatures; i++) totalImp += rawImportances[i];
    if (totalImp === 0) totalImp = 1.0;

    this.featureImportances = {};
    for (let i = 0; i < numFeatures; i++) {
      this.featureImportances[DELAY_FEATURE_NAMES[i]] = Number((rawImportances[i] / totalImp).toFixed(4));
    }

    this.isTrained = true;
  }

  public getFeatureImportances(): Record<string, number> {
    return { ...this.featureImportances };
  }

  /**
   * Evaluates project features across the Random Forest ensemble.
   */
  public predictProbabilities(x: number[]): number[] {
    const sumProbs = [0, 0, 0];
    for (const tree of this.trees) {
      const p = tree.predictProbabilities(x, tree.root);
      sumProbs[0] += p[0];
      sumProbs[1] += p[1];
      sumProbs[2] += p[2];
    }
    return sumProbs.map(s => Number((s / this.numTrees).toFixed(3)));
  }

  /**
   * Extracts features from OFFICIAL_PUBLIC + OPERATIONAL_UPDATE.
   */
  public extractFeatures(
    project: {
      status?: string;
      progress?: number | null;
      sanctionedAmount?: number;
      spentAmount?: number;
      startDate?: Date | string | null;
    },
    operationalUpdates?: Array<{ newProgress?: number | null; createdAt?: Date | string }>
  ): DelayRiskFeatures | null {
    const status = project.status || "Active";
    let progress = project.progress;
    const sanctioned = Number(project.sanctionedAmount) || 0;
    const spent = Number(project.spentAmount) || 0;

    // Operational updates provide ground-truth field progress
    if (operationalUpdates && operationalUpdates.length > 0) {
      const latest = operationalUpdates[operationalUpdates.length - 1];
      if (latest.newProgress !== undefined && latest.newProgress !== null) {
        progress = latest.newProgress;
      }
    }

    if (progress === undefined || progress === null) {
      if (status === "Completed") {
        progress = 100;
      } else {
        return null; // Declare INSUFFICIENT_DATA
      }
    }

    const progressPct = Number(progress);

    // Calculate elapsed days
    let elapsedDays = 120.0;
    if (project.startDate) {
      const dt = new Date(project.startDate);
      if (!isNaN(dt.getTime())) {
        const now = new Date();
        const diffMs = now.getTime() - dt.getTime();
        elapsedDays = Math.max(1.0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }
    }

    const expenditureRatio = sanctioned > 0 ? Number((spent / sanctioned).toFixed(3)) : 0.0;
    const updateCount = operationalUpdates?.length || 1;
    const updateFrequencyDays = Math.max(7.0, Math.floor(elapsedDays / updateCount));
    const progressVelocity = Number((progressPct / Math.max(1, elapsedDays)).toFixed(3));
    const milestonesCompletedRatio = Number((Math.min(1.0, progressPct / 100.0)).toFixed(3));

    return {
      progressPct,
      elapsedDays,
      expenditureRatio,
      updateFrequencyDays,
      progressVelocity,
      milestonesCompletedRatio,
    };
  }

  /**
   * Forecasts schedule delay risk using Random Forest.
   */
  public predict(
    project: {
      projectCode: string;
      status?: string;
      progress?: number | null;
      sanctionedAmount?: number;
      spentAmount?: number;
      startDate?: Date | string | null;
    },
    operationalUpdates?: Array<{ newProgress?: number | null; createdAt?: Date | string }>
  ): DelayRiskResult {
    const code = project.projectCode;
    const features = this.extractFeatures(project, operationalUpdates);

    if (!features) {
      return {
        module: "DELAY_RISK",
        model: "Random Forest",
        modelVersion: "v1.0-rf100-MDI",
        projectCode: code,
        status: "INSUFFICIENT_DATA",
        predictedClass: "UNKNOWN",
        confidence: 0.0,
        score: 0.0,
        threshold: 0.60,
        isAnomaly: false,
        explanation:
          `Project ${code} has not yet logged operational progress updates or execution milestones. ` +
          `Official public data currently provides administrative sanction only. ` +
          `Insufficient execution telemetry for Random Forest delay forecasting.`,
        probabilities: { ON_TIME: 0, AT_RISK: 0, DELAYED: 0 },
        featureImportances: this.getFeatureImportances(),
        features: null,
        trainingDataType: "DEMO_AUGMENTATION",
      };
    }

    const x = [
      features.progressPct,
      features.elapsedDays,
      features.expenditureRatio,
      features.updateFrequencyDays,
      features.progressVelocity,
      features.milestonesCompletedRatio,
    ];

    const probs = this.predictProbabilities(x);
    const probDict: Record<DelayClass, number> = {
      ON_TIME: probs[0],
      AT_RISK: probs[1],
      DELAYED: probs[2],
    };

    let maxIdx = 0;
    if (probs[1] > probs[maxIdx]) maxIdx = 1;
    if (probs[2] > probs[maxIdx]) maxIdx = 2;

    const predictedClass = DELAY_CLASSES[maxIdx];
    const confidence = probs[maxIdx];

    // Compute normalized risk score (0.0 to 1.0)
    let score: number;
    let isAnomaly: boolean;
    let status: "NORMAL" | "POTENTIAL_ANOMALY";

    if (predictedClass === "DELAYED") {
      score = Number((0.70 + (0.30 * probs[2])).toFixed(3));
      isAnomaly = true;
      status = "POTENTIAL_ANOMALY";
    } else if (predictedClass === "AT_RISK") {
      score = Number((0.40 + (0.30 * probs[1])).toFixed(3));
      isAnomaly = true;
      status = "POTENTIAL_ANOMALY";
    } else {
      score = Number((Math.max(0.05, 0.30 * (1.0 - confidence))).toFixed(3));
      isAnomaly = false;
      status = "NORMAL";
    }

    let explanation: string;
    if (predictedClass === "DELAYED") {
      explanation =
        `Random Forest classified project as DELAYED (confidence: ${(confidence * 100).toFixed(1)}%). ` +
        `Low progress velocity (${features.progressVelocity}) and stagnant completion (${(features.milestonesCompletedRatio * 100).toFixed(0)}%) ` +
        `after ${features.elapsedDays} elapsed days are the dominant contributing factors.`;
    } else if (predictedClass === "AT_RISK") {
      explanation =
        `Random Forest classified project as AT_RISK (confidence: ${(confidence * 100).toFixed(1)}%). ` +
        `Expenditure ratio (${(features.expenditureRatio * 100).toFixed(1)}%) outpaces physical progress (${features.progressPct}%), ` +
        `with infrequent operational updates (${features.updateFrequencyDays} day intervals).`;
    } else {
      explanation =
        `Random Forest predicted ON_TIME trajectory (confidence: ${(confidence * 100).toFixed(1)}%). ` +
        `Physical progress velocity (${features.progressVelocity}) is well-aligned with schedule.`;
    }

    return {
      module: "DELAY_RISK",
      model: "Random Forest",
      modelVersion: "v1.0-rf100-MDI",
      projectCode: code,
      status,
      predictedClass,
      confidence,
      score,
      threshold: 0.60,
      isAnomaly,
      explanation,
      probabilities: probDict,
      featureImportances: this.getFeatureImportances(),
      features,
      trainingDataType: "DEMO_AUGMENTATION",
    };
  }
}

export const randomForestEngine = new RandomForestClassifierEngine();
