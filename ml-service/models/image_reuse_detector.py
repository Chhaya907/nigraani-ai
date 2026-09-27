import io
import base64
from typing import Dict, Any, List, Optional, Tuple
from PIL import Image
import imagehash

class EvidenceReuseDetector:
    """
    Model 4: Evidence Reuse — Image Similarity
    Uses genuine perceptual hashing (pHash Discrete Cosine Transform + dHash gradient)
    to detect duplicate inspection photos, recycled site verification pictures,
    or slightly altered copies across different projects or milestones.
    """
    def __init__(self, max_hamming_distance: int = 10):
        # 64-bit hash: Hamming distance <= 10 indicates high perceptual similarity (>= 84%)
        self.max_hamming_distance = max_hamming_distance
        self.model_version = "ImageHash-pHash-dHash-v1.0"

    @staticmethod
    def compute_hashes_from_image(image: Image.Image) -> Dict[str, str]:
        """Calculates pHash, dHash, and aHash from a PIL Image."""
        # Convert to RGB if needed to normalize colorspace
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")

        phash_val = str(imagehash.phash(image))
        dhash_val = str(imagehash.dhash(image))
        ahash_val = str(imagehash.average_hash(image))

        return {
            "perceptualHash": phash_val,
            "differenceHash": dhash_val,
            "averageHash": ahash_val,
        }

    @staticmethod
    def compute_hashes_from_bytes(image_bytes: bytes) -> Dict[str, str]:
        """Calculates perceptual hashes directly from raw binary image bytes."""
        image = Image.open(io.BytesIO(image_bytes))
        return EvidenceReuseDetector.compute_hashes_from_image(image)

    @staticmethod
    def compute_hashes_from_base64(b64_string: str) -> Dict[str, str]:
        """Calculates perceptual hashes from a base64 encoded image string."""
        if "," in b64_string:
            b64_string = b64_string.split(",", 1)[1]
        raw_bytes = base64.b64decode(b64_string)
        return EvidenceReuseDetector.compute_hashes_from_bytes(raw_bytes)

    @staticmethod
    def calculate_hamming_distance(hash_a: str, hash_b: str) -> int:
        """Calculates bitwise Hamming distance between two hexadecimal hashes."""
        try:
            ha = imagehash.hex_to_hash(hash_a)
            hb = imagehash.hex_to_hash(hash_b)
            return int(ha - hb) # ImageHash overloaded subtraction calculates Hamming distance
        except Exception:
            # Fallback hex bitwise hamming distance
            val_a = int(hash_a, 16)
            val_b = int(hash_b, 16)
            xor_val = val_a ^ val_b
            return bin(xor_val).count('1')

    def compare_hashes(self, hash_a: str, hash_b: str) -> Tuple[int, float]:
        """
        Calculates Hamming distance and normalized similarity percentage.
        Distance 0 = identical image (100% similarity).
        Distance 64 = completely uncorrelated random bits (0% similarity).
        """
        dist = self.calculate_hamming_distance(hash_a, hash_b)
        similarity = max(0.0, min(1.0, 1.0 - (dist / 64.0)))
        return dist, similarity

    def scan_for_reuse(
        self,
        target_evidence: Dict[str, Any],
        existing_evidence_corpus: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Compares a target evidence document/photo against all existing evidence in the corpus.
        Returns INSUFFICIENT_DATA if no existing evidence hashes are available for comparison.
        """
        target_code = target_evidence.get("evidenceCode") or "EVID-TARGET"
        target_project = target_evidence.get("projectCode") or "UNKNOWN_PROJECT"
        target_hash = target_evidence.get("perceptualHash")

        if not target_hash:
            return {
                "module": "EVIDENCE_REUSE",
                "model": "Image Similarity (pHash / dHash)",
                "modelVersion": self.model_version,
                "evidenceCode": target_code,
                "projectCode": target_project,
                "status": "INSUFFICIENT_DATA",
                "score": 0.0,
                "isAnomaly": False,
                "explanation": (
                    f"Evidence record {target_code} does not contain a computed perceptual hash. "
                    "Upload a valid photographic site verification image to generate perceptual hash."
                ),
                "matchedEvidence": None,
            }

        # Filter out self-comparisons
        other_evidence = [
            e for e in existing_evidence_corpus
            if (e.get("evidenceCode") != target_code and e.get("perceptualHash"))
        ]

        if not other_evidence:
            return {
                "module": "EVIDENCE_REUSE",
                "model": "Image Similarity (pHash / dHash)",
                "modelVersion": self.model_version,
                "evidenceCode": target_code,
                "projectCode": target_project,
                "status": "INSUFFICIENT_DATA",
                "score": 0.0,
                "isAnomaly": False,
                "explanation": (
                    "No prior photographic evidence exists in the repository for comparison. "
                    "Perceptual hash computed and catalogued for future duplicate detection."
                ),
                "computedHash": target_hash,
                "matchedEvidence": None,
            }

        # Find closest match by Hamming distance
        best_match = None
        min_distance = 999
        max_similarity = 0.0

        for candidate in other_evidence:
            candidate_hash = candidate["perceptualHash"]
            dist, sim = self.compare_hashes(target_hash, candidate_hash)
            if dist < min_distance:
                min_distance = dist
                max_similarity = sim
                best_match = candidate

        is_anomaly = min_distance <= self.max_hamming_distance
        status = "POTENTIAL_ANOMALY" if is_anomaly else "NORMAL"

        matched_project = best_match.get("projectCode") if best_match else None
        matched_code = best_match.get("evidenceCode") if best_match else None
        cross_project = (matched_project != target_project) if (matched_project and target_project) else False

        if is_anomaly:
            explanation = (
                f"Potential evidence photo reuse detected! "
                f"Image hash '{target_hash}' closely matches evidence '{matched_code}' "
                f"{'(Project: ' + matched_project + ')' if cross_project else ''} "
                f"with Hamming distance {min_distance}/64 ({max_similarity:.1%} visual similarity). "
                f"Human review required to verify authenticity."
            )
        else:
            explanation = (
                f"Evidence image is distinct from catalogued records. "
                f"Closest candidate has Hamming distance {min_distance}/64 ({max_similarity:.1%} similarity), "
                f"which is within normal variance."
            )

        return {
            "module": "EVIDENCE_REUSE",
            "model": "Image Similarity (pHash / dHash)",
            "modelVersion": self.model_version,
            "evidenceCode": target_code,
            "projectCode": target_project,
            "status": status,
            "score": round(max_similarity, 3),
            "hammingDistance": min_distance,
            "maxAllowedDistance": self.max_hamming_distance,
            "isAnomaly": is_anomaly,
            "crossProject": cross_project,
            "explanation": explanation,
            "targetHash": target_hash,
            "matchedEvidence": {
                "evidenceCode": matched_code,
                "projectCode": matched_project,
                "perceptualHash": best_match.get("perceptualHash") if best_match else None,
                "title": best_match.get("title") if best_match else None,
            } if best_match else None,
        }
