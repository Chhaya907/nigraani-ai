import os
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

from models.duplicate_detector import DuplicateWorkDetector
from models.fund_movement_detector import FundMovementDetector
from models.delay_risk_detector import DelayRiskDetector
from models.image_reuse_detector import EvidenceReuseDetector

app = FastAPI(
    title="Nigraani AI ML Service",
    description="Real Machine Learning Ingestion & Inference Service for MPLADS Public Works Anomaly Detection",
    version="1.0.0"
)

# Initialize Real Model Engines
duplicate_detector = DuplicateWorkDetector()
fund_detector = FundMovementDetector()
delay_detector = DelayRiskDetector()
evidence_detector = EvidenceReuseDetector()

# ==============================================================================
# Pydantic Request Models
# ==============================================================================

class DuplicatePairRequest(BaseModel):
    project_a: Dict[str, Any]
    project_b: Dict[str, Any]
    threshold: Optional[float] = 0.75

class DuplicateScanRequest(BaseModel):
    projects: List[Dict[str, Any]]
    threshold: Optional[float] = 0.75

class FundMovementRequest(BaseModel):
    project: Dict[str, Any]
    expenditures: Optional[List[Dict[str, Any]]] = None

class DelayRiskRequest(BaseModel):
    project: Dict[str, Any]
    operational_updates: Optional[List[Dict[str, Any]]] = None

class EvidenceReuseRequest(BaseModel):
    target_evidence: Dict[str, Any]
    existing_evidence_corpus: Optional[List[Dict[str, Any]]] = []

class ComputeHashRequest(BaseModel):
    image_base64: str

# ==============================================================================
# Endpoints
# ==============================================================================

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "nigraani-ml-service",
        "version": "1.0.0",
        "models": {
            "duplicateWork": {
                "algorithm": "Semantic Similarity (Dense Transformer Embeddings)",
                "engine": duplicate_detector.model_name
            },
            "fundMovement": {
                "algorithm": "Isolation Forest",
                "engine": "scikit-learn IsolationForest",
                "trainingDataType": fund_detector.training_data_type
            },
            "delayRisk": {
                "algorithm": "Random Forest Classifier",
                "engine": "scikit-learn RandomForestClassifier",
                "featureImportances": delay_detector.feature_importances,
                "trainingDataType": delay_detector.training_data_type
            },
            "evidenceReuse": {
                "algorithm": "Perceptual Hashing (pHash + dHash)",
                "engine": "Discrete Cosine Transform (DCT) & Gradient Hashing"
            }
        }
    }

@app.post("/predict/duplicate")
def predict_duplicate(request: DuplicatePairRequest):
    """
    Model 1: Evaluates two projects for semantic duplication using genuine embeddings.
    """
    try:
        result = duplicate_detector.compare_pair(
            project_a=request.project_a,
            project_b=request.project_b,
            threshold=request.threshold
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Duplicate prediction failed: {str(e)}")

@app.post("/scan/duplicates")
def scan_all_duplicates(request: DuplicateScanRequest):
    """
    Scans entire project dataset and returns all pairs exceeding the similarity threshold.
    """
    try:
        results = duplicate_detector.scan_all_pairs(
            projects=request.projects,
            threshold=request.threshold
        )
        return {"totalPairsScanned": len(request.projects) * (len(request.projects) - 1) // 2 if len(request.projects) > 1 else 0, "anomalies": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Duplicate scan failed: {str(e)}")

@app.post("/predict/fund-movement")
def predict_fund_movement(request: FundMovementRequest):
    """
    Model 2: Evaluates financial transactions using genuine Isolation Forest.
    Returns INSUFFICIENT_DATA if official history does not have required granularity.
    """
    try:
        result = fund_detector.predict(
            project=request.project,
            expenditures=request.expenditures
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fund movement prediction failed: {str(e)}")

@app.post("/predict/delay-risk")
def predict_delay_risk(request: DelayRiskRequest):
    """
    Model 3: Forecasts project delay risk using genuine Random Forest.
    Returns class probabilities, confidence, feature importances, and explanation.
    """
    try:
        result = delay_detector.predict(
            project=request.project,
            operational_updates=request.operational_updates
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delay risk prediction failed: {str(e)}")

@app.post("/predict/evidence-reuse")
def predict_evidence_reuse(request: EvidenceReuseRequest):
    """
    Model 4: Compares perceptual image hashes across evidence documents.
    Detects recycled inspection photos with Hamming distance threshold.
    """
    try:
        result = evidence_detector.scan_for_reuse(
            target_evidence=request.target_evidence,
            existing_evidence_corpus=request.existing_evidence_corpus or []
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Evidence reuse prediction failed: {str(e)}")

@app.post("/compute/image-hash")
def compute_image_hash(request: ComputeHashRequest):
    """
    Computes perceptual hashes (pHash, dHash, aHash) directly from base64 image data.
    """
    try:
        hashes = EvidenceReuseDetector.compute_hashes_from_base64(request.image_base64)
        return hashes
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to compute perceptual hash: {str(e)}")

if __name__ == "__main__":
    port = int(os.environ.get("ML_SERVICE_PORT", "5001"))
    print(f"Starting Nigraani AI ML Service on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
