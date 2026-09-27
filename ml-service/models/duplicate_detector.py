import numpy as np
from typing import List, Dict, Any, Optional
from fastembed import TextEmbedding

class DuplicateWorkDetector:
    """
    Model 1: Duplicate Work — Semantic Similarity
    Uses genuine dense transformer text embeddings (BAAI/bge-small-en-v1.5)
    to calculate cosine similarity between project scopes, titles, and locations.
    """
    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5", default_threshold: float = 0.75):
        self.model_name = model_name
        self.default_threshold = default_threshold
        # Initialize the actual local embedding model
        self.embedding_model = TextEmbedding(model_name=model_name)

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """Generates dense vector embeddings for input strings."""
        generator = self.embedding_model.embed(texts)
        embeddings = np.array(list(generator))
        # Normalize embeddings to unit vectors for stable cosine similarity
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1e-12
        return embeddings / norms

    @staticmethod
    def construct_text_payload(project: Dict[str, Any]) -> str:
        """Combines title, description, and location context into a rich semantic string."""
        title = (project.get("title") or "").strip()
        description = (project.get("description") or "").strip()
        district = (project.get("district") or "").strip()
        state = (project.get("state") or "").strip()
        category = (project.get("category") or "").strip()

        parts = []
        if title:
            parts.append(f"Work: {title}.")
        if description:
            parts.append(f"Description: {description}.")
        if category:
            parts.append(f"Category: {category}.")
        if district or state:
            parts.append(f"Jurisdiction: {district}, {state}.")

        return " ".join(parts)

    def compare_pair(
        self,
        project_a: Dict[str, Any],
        project_b: Dict[str, Any],
        threshold: Optional[float] = None
    ) -> Dict[str, Any]:
        """Compares two specific projects and evaluates potential duplication."""
        th = threshold if threshold is not None else self.default_threshold
        text_a = self.construct_text_payload(project_a)
        text_b = self.construct_text_payload(project_b)

        embeddings = self.embed_texts([text_a, text_b])
        # Cosine similarity of unit vectors is simply dot product
        cosine_sim = float(np.dot(embeddings[0], embeddings[1]))
        cosine_sim = max(0.0, min(1.0, cosine_sim)) # clamp to [0, 1]

        code_a = project_a.get("projectCode") or project_a.get("work_id") or "UNKNOWN_A"
        code_b = project_b.get("projectCode") or project_b.get("work_id") or "UNKNOWN_B"
        district_a = project_a.get("district") or project_a.get("district_name") or ""
        district_b = project_b.get("district") or project_b.get("district_name") or ""
        same_district = (district_a.lower() == district_b.lower()) if (district_a and district_b) else False

        is_anomaly = cosine_sim >= th
        status = "POTENTIAL_ANOMALY" if is_anomaly else "NORMAL"

        if is_anomaly:
            explanation = (
                f"Projects {code_a} and {code_b} exhibit high semantic overlap (score: {cosine_sim:.3f} >= threshold {th:.2f}). "
                f"{'Both works share district jurisdiction: ' + district_a + '. ' if same_district else ''}"
                f"Potential scope overlap detected — human verification required."
            )
        else:
            explanation = (
                f"Semantic similarity score {cosine_sim:.3f} is below the duplicate threshold of {th:.2f}. "
                f"Scopes appear distinct."
            )

        return {
            "module": "DUPLICATE_WORK",
            "model": "Semantic Similarity",
            "modelVersion": f"fastembed-{self.model_name}",
            "projectA": code_a,
            "projectB": code_b,
            "score": round(cosine_sim, 3),
            "threshold": th,
            "status": status,
            "isAnomaly": is_anomaly,
            "sameDistrict": same_district,
            "explanation": explanation,
            "matchedContext": {
                "titleA": project_a.get("title") or project_a.get("work_name"),
                "titleB": project_b.get("title") or project_b.get("work_name"),
                "districtA": district_a,
                "districtB": district_b,
            }
        }

    def scan_all_pairs(
        self,
        projects: List[Dict[str, Any]],
        threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """Scans all pairs of projects in the dataset for semantic duplication."""
        th = threshold if threshold is not None else self.default_threshold
        if len(projects) < 2:
            return []

        texts = [self.construct_text_payload(p) for p in projects]
        embeddings = self.embed_texts(texts)

        results = []
        n = len(projects)
        # Compute pairwise cosine similarity matrix
        sim_matrix = np.dot(embeddings, embeddings.T)

        for i in range(n):
            for j in range(i + 1, n):
                score = float(max(0.0, min(1.0, sim_matrix[i, j])))
                if score >= th:
                    pair_result = self.compare_pair(projects[i], projects[j], threshold=th)
                    results.append(pair_result)

        return sorted(results, key=lambda x: x["score"], reverse=True)
