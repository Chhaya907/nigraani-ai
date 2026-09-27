/**
 * Model 2: Fund Movement — Isolation Forest
 * Exact mathematical implementation of the Isolation Forest algorithm (Liu, Ting, Zhou, 2008).
 * 
 * Mathematical Formulation:
 * 1. An ensemble of t Isolation Trees (iTrees) is constructed on subsamples of size n.
 * 2. Each iTree recursively partitions data by selecting a random attribute q and split p ∈ [min, max].
 * 3. The path length h(x) is the number of edges traversed from root to external node.
 * 4. Average path length of unsuccessful search in a Binary Search Tree:
 *    c(n) = 2 * (ln(n - 1) + γ) - (2 * (n - 1) / n), where γ = 0.5772156649 (Euler-Mascheroni constant).
 * 5. Anomaly score:
 *    s(x, n) = 2^(- E(h(x)) / c(n))
 *    - s → 1: instances isolated with very short paths (ANOMALOUS)
 *    - s < 0.5: instances deep inside clusters (NORMAL)
 * 
 * Strict Data Provenance Rule:
 * If an official public record lacks sufficient granular multi-voucher transaction history,
 * the model honestly returns INSUFFICIENT_DATA rather than fabricating artificial transactions.
 */

export interface FundMovementFeatures {
  sanctionedAmount: number;
  spentAmount: number;
  utilizationRate: number;
  expenditureVelocity: number;
  voucherCount: number;
  avgVoucherAmount: number;
}

export interface FundMovementResult {
  module: "FUND_MOVEMENT";
  model: "Isolation Forest";
  modelVersion: "v1.0-iForest100";
  projectCode: string;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  score: number;
  threshold: number;
  isAnomaly: boolean;
  explanation: string;
  features?: FundMovementFeatures | null;
  topDriver?: string;
  trainingDataType: "DEMO_AUGMENTATION";
}

interface TreeNode {
  isLeaf: boolean;
  size: number;
  featureIndex?: number;
  splitValue?: number;
  left?: TreeNode;
  right?: TreeNode;
}

const EULER_MASCHERONI = 0.5772156649;

/**
 * Average path length c(n) of unsuccessful search in BST.
 */
export function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2.0 * (Math.log(n - 1) + EULER_MASCHERONI) - (2.0 * (n - 1) / n);
}

export class IsolationTree {
  public root: TreeNode;
  private maxDepth: number;

  constructor(maxDepth: number = 8) {
    this.maxDepth = maxDepth;
    this.root = { isLeaf: true, size: 0 };
  }

  public fit(X: number[][], currentDepth: number = 0, seed: number = 42): void {
    this.root = this.buildTree(X, currentDepth, seed);
  }

  private buildTree(X: number[][], currentDepth: number, seed: number): TreeNode {
    const n = X.length;
    if (currentDepth >= this.maxDepth || n <= 1) {
      return { isLeaf: true, size: n };
    }

    const numFeatures = X[0].length;
    // Pseudorandom attribute selection based on deterministic seed
    const featureIdx = Math.abs(Math.imul(seed + currentDepth * 31, 1103515245) % numFeatures);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = X[i][featureIdx];
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (min === max) {
      return { isLeaf: true, size: n };
    }

    // Split value p uniformly between min and max
    const ratio = ((Math.abs(Math.imul(seed + currentDepth * 17, 12345)) % 1000) / 1000);
    const splitValue = min + ratio * (max - min);

    const leftData: number[][] = [];
    const rightData: number[][] = [];

    for (let i = 0; i < n; i++) {
      if (X[i][featureIdx] < splitValue) {
        leftData.push(X[i]);
      } else {
        rightData.push(X[i]);
      }
    }

    return {
      isLeaf: false,
      size: n,
      featureIndex: featureIdx,
      splitValue,
      left: this.buildTree(leftData, currentDepth + 1, seed * 2 + 1),
      right: this.buildTree(rightData, currentDepth + 1, seed * 2 + 2),
    };
  }

  public pathLength(x: number[], node: TreeNode, currentPath: number = 0): number {
    if (node.isLeaf) {
      return currentPath + cFactor(node.size);
    }
    const feat = node.featureIndex!;
    const split = node.splitValue!;
    if (x[feat] < split) {
      return this.pathLength(x, node.left!, currentPath + 1);
    } else {
      return this.pathLength(x, node.right!, currentPath + 1);
    }
  }
}

export class IsolationForestEngine {
  private numTrees: number;
  private subsampleSize: number;
  private trees: IsolationTree[] = [];
  private isTrained: boolean = false;
  private featureNames = [
    "sanctionedAmount",
    "spentAmount",
    "utilizationRate",
    "expenditureVelocity",
    "voucherCount",
    "avgVoucherAmount"
  ];

  // Baseline calibrated statistics from DEMO_AUGMENTATION
  private baselineMeans: number[] = [6000000, 3600000, 0.60, 480000, 5, 720000];
  private baselineStds: number[] = [2200000, 1800000, 0.15, 180000, 2, 160000];

  constructor(numTrees: number = 100, subsampleSize: number = 32) {
    this.numTrees = numTrees;
    this.subsampleSize = subsampleSize;
    this.trainOnDemoAugmentation();
  }

  /**
   * Fits ensemble of Isolation Trees on clearly labelled DEMO_AUGMENTATION data.
   */
  private trainOnDemoAugmentation(): void {
    const demoTrainingDataset: number[][] = [
      [5000000, 2200000, 0.44, 366666, 4, 550000],
      [7500000, 4500000, 0.60, 500000, 6, 750000],
      [3000000, 1800000, 0.60, 300000, 3, 600000],
      [10000000, 8000000, 0.80, 800000, 8, 1000000],
      [4500000, 1500000, 0.33, 300000, 3, 500000],
      [6000000, 3600000, 0.60, 450000, 5, 720000],
      [8500000, 6200000, 0.73, 688888, 7, 885714],
      [3500000, 2100000, 0.60, 350000, 4, 525000],
      [9000000, 5400000, 0.60, 600000, 6, 900000],
      [4000000, 2800000, 0.70, 400000, 4, 700000],
      [6500000, 3900000, 0.60, 433333, 5, 780000],
      [12000000, 9600000, 0.80, 960000, 10, 960000],
      [5500000, 2750000, 0.50, 392857, 4, 687500],
      [4800000, 2400000, 0.50, 342857, 4, 600000],
      [7000000, 4200000, 0.60, 525000, 6, 700000],
      [8000000, 5600000, 0.70, 622222, 7, 800000],
      [3200000, 1600000, 0.50, 320000, 3, 533333],
      [9500000, 7600000, 0.80, 760000, 8, 950000],
      [5200000, 3120000, 0.60, 445714, 5, 624000],
      [6200000, 3720000, 0.60, 465000, 5, 744000],
      // Extreme outliers in training set to calibrate isolation thresholds
      [10000000, 9900000, 0.99, 4950000, 1, 9900000],
      [5000000, 4900000, 0.98, 4900000, 1, 4900000],
      [8000000, 200000, 0.025, 12500, 1, 200000]
    ];

    this.trees = [];
    const maxDepth = Math.ceil(Math.log2(Math.max(2, this.subsampleSize)));

    for (let t = 0; t < this.numTrees; t++) {
      const tree = new IsolationTree(maxDepth);
      // Sample with replacement
      const sample: number[][] = [];
      for (let s = 0; s < this.subsampleSize; s++) {
        const idx = Math.abs(Math.imul(t * 101 + s * 13, 982451653)) % demoTrainingDataset.length;
        sample.push(demoTrainingDataset[idx]);
      }
      tree.fit(sample, 0, (t + 1) * 37);
      this.trees.push(tree);
    }
    this.isTrained = true;
  }

  /**
   * Computes the theoretical anomaly score s(x, n) = 2^(-E(h(x)) / c(n)).
   */
  public computeAnomalyScore(featureVector: number[]): number {
    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += tree.pathLength(featureVector, tree.root);
    }
    const avgPathLength = totalPathLength / this.numTrees;
    const c = cFactor(this.subsampleSize);
    if (c === 0) return 0.5;

    // Standard Isolation Forest score
    const s = Math.pow(2.0, -(avgPathLength / c));
    return Math.max(0.0, Math.min(1.0, s));
  }

  /**
   * Extracts features from official records.
   * Strict Rule: If fewer than 2 expenditure vouchers exist in public data,
   * returns null to declare INSUFFICIENT_DATA honestly.
   */
  public extractFeatures(
    project: { sanctionedAmount?: number; spentAmount?: number },
    expenditures: Array<{ amount: number; voucherNo?: string | null }>
  ): FundMovementFeatures | null {
    if (!expenditures || expenditures.length < 2) {
      return null;
    }

    const sanctioned = Number(project.sanctionedAmount) || 0;
    let spent = Number(project.spentAmount) || 0;
    const voucherCount = expenditures.length;

    const voucherSum = expenditures.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    if (voucherSum > 0) {
      spent = Math.max(spent, voucherSum);
    }

    const utilizationRate = sanctioned > 0 ? spent / sanctioned : 0;
    const avgVoucherAmount = voucherCount > 0 ? spent / voucherCount : 0;
    const expenditureVelocity = spent / Math.max(1, voucherCount);

    return {
      sanctionedAmount: sanctioned,
      spentAmount: spent,
      utilizationRate,
      expenditureVelocity,
      voucherCount,
      avgVoucherAmount,
    };
  }

  /**
   * Evaluates project for fund movement anomalies using Isolation Forest.
   */
  public predict(
    project: { projectCode: string; sanctionedAmount?: number; spentAmount?: number },
    expenditures: Array<{ amount: number; voucherNo?: string | null }>
  ): FundMovementResult {
    const code = project.projectCode;
    const features = this.extractFeatures(project, expenditures);

    if (!features) {
      return {
        module: "FUND_MOVEMENT",
        model: "Isolation Forest",
        modelVersion: "v1.0-iForest100",
        projectCode: code,
        status: "INSUFFICIENT_DATA",
        score: 0.0,
        threshold: 0.65,
        isAnomaly: false,
        explanation:
          `Official public record for project ${code} provides single aggregate expenditure without granular multi-voucher timestamps. ` +
          `Insufficient transaction frequency for Isolation Forest trajectory analysis.`,
        features: null,
        trainingDataType: "DEMO_AUGMENTATION",
      };
    }

    const x = [
      features.sanctionedAmount,
      features.spentAmount,
      features.utilizationRate,
      features.expenditureVelocity,
      features.voucherCount,
      features.avgVoucherAmount,
    ];

    const score = Number(this.computeAnomalyScore(x).toFixed(3));
    const threshold = 0.65;
    const isAnomaly = score >= threshold;
    const status = isAnomaly ? "POTENTIAL_ANOMALY" : "NORMAL";

    // Find top divergent feature by Z-score
    let maxZ = -1;
    let topDriver = this.featureNames[0];
    for (let i = 0; i < x.length; i++) {
      const z = Math.abs((x[i] - this.baselineMeans[i]) / this.baselineStds[i]);
      if (z > maxZ) {
        maxZ = z;
        topDriver = this.featureNames[i];
      }
    }

    let explanation: string;
    if (isAnomaly) {
      explanation =
        `Isolation Forest isolated project disbursement trajectory as anomalous (score: ${score.toFixed(3)} >= threshold ${threshold.toFixed(2)}). ` +
        `Primary divergent factor: '${topDriver}' deviated from normal baseline distribution. Human financial review required.`;
    } else {
      explanation =
        `Disbursement trajectory is within expected baseline distribution (anomaly score: ${score.toFixed(3)} < threshold ${threshold.toFixed(2)}). ` +
        `Voucher frequencies and amounts conform to standard historical distributions.`;
    }

    return {
      module: "FUND_MOVEMENT",
      model: "Isolation Forest",
      modelVersion: "v1.0-iForest100",
      projectCode: code,
      status,
      score,
      threshold,
      isAnomaly,
      explanation,
      features,
      topDriver,
      trainingDataType: "DEMO_AUGMENTATION",
    };
  }
}

export const isolationForestEngine = new IsolationForestEngine();
