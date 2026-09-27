/**
 * Model 1: Duplicate Work — Semantic Similarity
 * Implements genuine NLP text embedding with subword n-gram frequency hashing
 * and vector normalization, followed by exact cosine similarity calculation.
 * 
 * Pipeline:
 * Project title + description + location context
 *   ↓
 * Text preprocessing & subword tokenization
 *   ↓
 * High-dimensional dense vector embedding (d = 128)
 *   ↓
 * L2 unit-norm normalization
 *   ↓
 * Cosine similarity calculation: cos(θ) = (u · v) / (||u|| * ||v||)
 *   ↓
 * Configurable threshold comparison (default: 0.70)
 *   ↓
 * Potential Duplicate Work detection with explainability
 */

export interface SemanticProjectInput {
  projectCode: string;
  title: string;
  description?: string | null;
  state: string;
  district: string;
  category?: string | null;
}

export interface DuplicateDetectionResult {
  module: "DUPLICATE_WORK";
  model: "Semantic Similarity (NLP Vector Embedding)";
  modelVersion: "v1.0-dense128";
  projectA: string;
  projectB: string;
  score: number;
  threshold: number;
  status: "NORMAL" | "POTENTIAL_ANOMALY" | "INSUFFICIENT_DATA";
  isAnomaly: boolean;
  sameDistrict: boolean;
  explanation: string;
  matchedContext: {
    titleA: string;
    titleB: string;
    districtA: string;
    districtB: string;
    sharedTerms: string[];
  };
}

export class SemanticSimilarityEngine {
  private dimension: number;
  private defaultThreshold: number;

  constructor(dimension: number = 128, defaultThreshold: number = 0.70) {
    this.dimension = dimension;
    this.defaultThreshold = defaultThreshold;
  }

  /**
   * Normalizes and cleans input text (lowercasing, punctuation stripping, stopword removal).
   */
  public preprocess(text: string): string[] {
    if (!text) return [];
    const stopWords = new Set([
      "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "with", "by", "of", "from",
      "is", "are", "was", "were", "be", "been", "this", "that", "these", "those", "it", "its"
    ]);

    const cleaned = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return cleaned;
  }

  /**
   * Generates a deterministic dense embedding vector in R^d using feature hashing with subwords.
   * Produces smooth semantic overlap for morphological variations (e.g. filtration/filter/filtered).
   */
  public generateEmbedding(text: string): Float64Array {
    const vector = new Float64Array(this.dimension);
    const tokens = this.preprocess(text);

    if (tokens.length === 0) {
      return vector;
    }

    // Hash tokens and character 3-grams to dense embedding dimensions
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const weight = 1.0 / Math.sqrt(tokens.length);

      // Whole token hash
      const hToken = this.hashString(token) % this.dimension;
      const signToken = (this.hashString(token + "_s") % 2 === 0) ? 1 : -1;
      vector[hToken] += signToken * weight;

      // Subword character trigrams
      if (token.length >= 3) {
        for (let j = 0; j <= token.length - 3; j++) {
          const trigram = token.substring(j, j + 3);
          const hTri = this.hashString(trigram) % this.dimension;
          const signTri = (this.hashString(trigram + "_s") % 2 === 0) ? 1 : -1;
          vector[hTri] += signTri * (weight * 0.4);
        }
      }
    }

    // L2 Normalization: v_norm = v / ||v||_2
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 1e-12) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * Calculates exact cosine similarity between two vectors:
   * cos(u, v) = (u · v) / (||u|| * ||v||)
   */
  public cosineSimilarity(vecA: Float64Array, vecB: Float64Array): number {
    const len = Math.min(vecA.length, vecB.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom <= 1e-12) return 0;
    return Math.max(0.0, Math.min(1.0, dot / denom));
  }

  /**
   * Constructs the full semantic payload from project metadata.
   * Emphasizes title and scope description for accurate semantic separation.
   */
  public constructPayload(project: SemanticProjectInput): string {
    const parts: string[] = [];
    if (project.title) {
      // Primary semantic signal: title
      parts.push(project.title);
      parts.push(project.title);
    }
    if (project.description) {
      // Secondary semantic signal: detailed description
      parts.push(project.description);
    }
    if (project.category) {
      parts.push(project.category);
    }
    if (project.district) {
      parts.push(project.district);
    }
    return parts.join(" ");
  }

  /**
   * Compares two specific projects and evaluates potential duplication.
   */
  public comparePair(
    projectA: SemanticProjectInput,
    projectB: SemanticProjectInput,
    threshold?: number
  ): DuplicateDetectionResult {
    const th = threshold ?? this.defaultThreshold;
    const textA = this.constructPayload(projectA);
    const textB = this.constructPayload(projectB);

    const embA = this.generateEmbedding(textA);
    const embB = this.generateEmbedding(textB);

    const rawSim = this.cosineSimilarity(embA, embB);
    const score = Number(rawSim.toFixed(3));

    const sameDistrict = projectA.district.toLowerCase().trim() === projectB.district.toLowerCase().trim();
    const isAnomaly = score >= th;
    const status = isAnomaly ? "POTENTIAL_ANOMALY" : "NORMAL";

    // Extract overlapping terms for explanation
    const tokensA = new Set(this.preprocess(`${projectA.title} ${projectA.description || ""}`));
    const tokensB = new Set(this.preprocess(`${projectB.title} ${projectB.description || ""}`));
    const sharedTerms = Array.from(tokensA).filter(t => tokensB.has(t)).slice(0, 5);

    let explanation: string;
    if (isAnomaly) {
      explanation =
        `Projects ${projectA.projectCode} and ${projectB.projectCode} exhibit high semantic similarity (${score.toFixed(3)} >= threshold ${th.toFixed(2)}). ` +
        `${sameDistrict ? `Both works share district jurisdiction: ${projectA.district}. ` : ""}` +
        `${sharedTerms.length > 0 ? `Key overlapping scope terms: [${sharedTerms.join(", ")}]. ` : ""}` +
        `Potential duplicate work detected — human verification required.`;
    } else {
      explanation =
        `Semantic similarity score (${score.toFixed(3)}) is below the duplicate detection threshold of ${th.toFixed(2)}. ` +
        `Project scopes appear distinct.`;
    }

    return {
      module: "DUPLICATE_WORK",
      model: "Semantic Similarity (NLP Vector Embedding)",
      modelVersion: "v1.0-dense128",
      projectA: projectA.projectCode,
      projectB: projectB.projectCode,
      score,
      threshold: th,
      status,
      isAnomaly,
      sameDistrict,
      explanation,
      matchedContext: {
        titleA: projectA.title,
        titleB: projectB.title,
        districtA: projectA.district,
        districtB: projectB.district,
        sharedTerms,
      },
    };
  }

  /**
   * Scans an entire list of projects for pairs exceeding the threshold.
   */
  public scanAll(projects: SemanticProjectInput[], threshold?: number): DuplicateDetectionResult[] {
    const results: DuplicateDetectionResult[] = [];
    const n = projects.length;
    if (n < 2) return [];

    const th = threshold ?? this.defaultThreshold;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const res = this.comparePair(projects[i], projects[j], th);
        if (res.isAnomaly) {
          results.push(res);
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }
}

export const semanticSimilarityEngine = new SemanticSimilarityEngine();
