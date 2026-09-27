import os
import json
import numpy as np
from typing import Dict, Any, List, Optional
from sklearn.ensemble import IsolationForest

class FundMovementDetector:
    """
    Model 2: Fund Movement — Isolation Forest
    Uses genuine scikit-learn IsolationForest algorithm to detect anomalous
    disbursement velocity, abnormal utilization spikes, or voucher patterns.
    """
    FEATURE_NAMES = [
        "sanctioned_amount",
        "spent_amount",
        "utilization_rate",
        "expenditure_velocity",
        "voucher_count",
        "avg_voucher_amount"
    ]

    def __init__(self, training_data_path: Optional[str] = None, contamination: float = 0.1):
        self.contamination = contamination
        self.model = IsolationForest(
            n_estimators=100,
            contamination=contamination,
            random_state=42,
            n_jobs=-1
        )
        self.is_trained = False
        self.training_data_type = "DEMO_AUGMENTATION"
        self.model_version = "IsolationForest-scikit-learn-v1.0"

        # Resolve training data path
        if not training_data_path:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            training_data_path = os.path.join(base_dir, "data", "demo_fund_training.json")

        self.training_data_path = training_data_path
        self._fit_on_demo_augmentation()

    def _fit_on_demo_augmentation(self):
        """Fits the Isolation Forest on clearly labelled DEMO_AUGMENTATION data."""
        if not os.path.exists(self.training_data_path):
            raise FileNotFoundError(f"Training data not found at {self.training_data_path}")

        with open(self.training_data_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        records = data.get("records", [])
        if not records:
            raise ValueError("Training dataset has no records")

        X = []
        for r in records:
            X.append([
                float(r["sanctioned_amount"]),
                float(r["spent_amount"]),
                float(r["utilization_rate"]),
                float(r["expenditure_velocity"]),
                float(r["voucher_count"]),
                float(r["avg_voucher_amount"]),
            ])

        X_train = np.array(X)
        self.mean_vector = np.mean(X_train, axis=0)
        self.std_vector = np.std(X_train, axis=0)
        self.std_vector[self.std_vector == 0] = 1.0

        self.model.fit(X_train)
        self.is_trained = True

    def extract_features(self, project: Dict[str, Any], expenditures: List[Dict[str, Any]]) -> Optional[np.ndarray]:
        """
        Extracts features from project and its expenditure history.
        Strict rule: If insufficient financial history exists in official records (fewer than 2
        expenditures or no vouchers), returns None to indicate INSUFFICIENT_DATA.
        """
        sanctioned = float(project.get("sanctionedAmount") or 0.0)
        spent = float(project.get("spentAmount") or 0.0)

        # Check if project has actual expenditure entries
        if not expenditures or len(expenditures) < 2:
            return None

        voucher_count = len(expenditures)
        total_voucher_sum = sum(float(e.get("amount") or 0.0) for e in expenditures)
        if total_voucher_sum > 0:
            spent = max(spent, total_voucher_sum)

        utilization_rate = (spent / sanctioned) if sanctioned > 0 else 0.0
        avg_voucher_amount = spent / voucher_count if voucher_count > 0 else 0.0

        # Estimate expenditure velocity (INR per month or period)
        # Using voucher count and elapsed time
        velocity = spent / max(1.0, float(voucher_count))

        return np.array([
            sanctioned,
            spent,
            utilization_rate,
            velocity,
            float(voucher_count),
            avg_voucher_amount
        ])

    def predict(
        self,
        project: Dict[str, Any],
        expenditures: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Evaluates a project for fund movement anomalies.
        Returns INSUFFICIENT_DATA if official history does not have required granularity.
        """
        code = project.get("projectCode") or project.get("work_id") or "UNKNOWN"
        exp_list = expenditures or []

        features = self.extract_features(project, exp_list)
        if features is None:
            return {
                "module": "FUND_MOVEMENT",
                "model": "Isolation Forest",
                "modelVersion": self.model_version,
                "projectCode": code,
                "status": "INSUFFICIENT_DATA",
                "score": 0.0,
                "threshold": 0.65,
                "isAnomaly": False,
                "explanation": (
                    f"Official public record for project {code} contains single aggregate expenditure. "
                    "Granular voucher intervals are unavailable in public summary. "
                    "Insufficient data for reliable Isolation Forest trajectory analysis."
                ),
                "features": None,
                "trainingDataType": self.training_data_type,
            }

        X = features.reshape(1, -1)
        # decision_function gives negative values for anomalies, positive for inliers
        raw_decision = float(self.model.decision_function(X)[0])
        pred = int(self.model.predict(X)[0]) # -1 = anomaly, 1 = normal

        # Convert decision function to normalized 0-1 anomaly score
        # In scikit-learn, offset_ is typically -0.5
        # Higher score = more anomalous
        anomaly_score = float(max(0.0, min(1.0, 0.5 - (raw_decision * 1.5))))

        is_anomaly = (pred == -1) or (anomaly_score >= 0.65)
        status = "POTENTIAL_ANOMALY" if is_anomaly else "NORMAL"

        # Determine which feature contributed most to anomaly
        z_scores = np.abs((features - self.mean_vector) / self.std_vector)
        max_idx = int(np.argmax(z_scores))
        top_driver = self.FEATURE_NAMES[max_idx]

        if is_anomaly:
            explanation = (
                f"Isolation Forest flagged potential fund movement anomaly (score: {anomaly_score:.3f}). "
                f"Primary divergent feature: '{top_driver}' deviated significantly from baseline patterns. "
                "Human audit verification required."
            )
        else:
            explanation = (
                f"Fund movement within expected baseline distribution (anomaly score: {anomaly_score:.3f}). "
                "Disbursement trajectory is consistent with historical patterns."
            )

        return {
            "module": "FUND_MOVEMENT",
            "model": "Isolation Forest",
            "modelVersion": self.model_version,
            "projectCode": code,
            "status": status,
            "score": round(anomaly_score, 3),
            "threshold": 0.65,
            "isAnomaly": is_anomaly,
            "explanation": explanation,
            "features": {
                name: round(float(val), 2)
                for name, val in zip(self.FEATURE_NAMES, features)
            },
            "topDriver": top_driver,
            "trainingDataType": self.training_data_type,
        }
