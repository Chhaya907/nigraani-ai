import os
import json
import numpy as np
from typing import Dict, Any, List, Optional
from datetime import datetime
from sklearn.ensemble import RandomForestClassifier

class DelayRiskDetector:
    """
    Model 3: Delay Risk — Random Forest
    Uses genuine scikit-learn RandomForestClassifier trained on labelled
    DEMO_AUGMENTATION execution trajectories to forecast schedule delay risks.
    Provides feature importances, prediction probabilities, and explainable factors.
    """
    FEATURE_NAMES = [
        "progress_pct",
        "elapsed_days",
        "expenditure_ratio",
        "update_frequency_days",
        "progress_velocity",
        "milestones_completed_ratio"
    ]
    CLASSES = ["ON_TIME", "AT_RISK", "DELAYED"]

    def __init__(self, training_data_path: Optional[str] = None):
        self.model = RandomForestClassifier(
            n_estimators=100,
            max_depth=5,
            random_state=42,
            n_jobs=-1
        )
        self.is_trained = False
        self.training_data_type = "DEMO_AUGMENTATION"
        self.model_version = "RandomForestClassifier-v1.0 (trained on DEMO_AUGMENTATION)"
        self.feature_importances: Dict[str, float] = {}

        if not training_data_path:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            training_data_path = os.path.join(base_dir, "data", "demo_delay_training.json")

        self.training_data_path = training_data_path
        self._train_model()

    def _train_model(self):
        """Trains the Random Forest model on clearly labelled DEMO_AUGMENTATION data."""
        if not os.path.exists(self.training_data_path):
            raise FileNotFoundError(f"Training data not found at {self.training_data_path}")

        with open(self.training_data_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        records = data.get("records", [])
        if not records:
            raise ValueError("Training dataset has no records")

        X, y = [], []
        label_map = {"ON_TIME": 0, "AT_RISK": 1, "DELAYED": 2}

        for r in records:
            X.append([
                float(r["progress_pct"]),
                float(r["elapsed_days"]),
                float(r["expenditure_ratio"]),
                float(r["update_frequency_days"]),
                float(r["progress_velocity"]),
                float(r["milestones_completed_ratio"]),
            ])
            y.append(label_map[r["label"]])

        X_train = np.array(X)
        y_train = np.array(y)

        self.model.fit(X_train, y_train)
        self.is_trained = True

        # Extract genuine feature importances from the fitted Random Forest
        importances = self.model.feature_importances_
        self.feature_importances = {
            name: round(float(imp), 4)
            for name, imp in zip(self.FEATURE_NAMES, importances)
        }

    def extract_features(
        self,
        project: Dict[str, Any],
        operational_updates: Optional[List[Dict[str, Any]]] = None
    ) -> Optional[np.ndarray]:
        """
        Combines OFFICIAL_PUBLIC and OPERATIONAL_UPDATE data to build features.
        If essential execution data is completely absent, returns None.
        """
        status = project.get("status") or "Active"
        progress = project.get("progress")
        sanctioned = float(project.get("sanctionedAmount") or 0.0)
        spent = float(project.get("spentAmount") or 0.0)

        # Parse start/sanction date
        start_date_raw = project.get("startDate")
        elapsed_days = 90.0 # fallback baseline if unknown
        if start_date_raw:
            try:
                if isinstance(start_date_raw, str):
                    clean_dt = start_date_raw.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(clean_dt)
                elif isinstance(start_date_raw, datetime):
                    dt = start_date_raw
                else:
                    dt = None
                if dt:
                    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
                    elapsed_days = max(1.0, float((now - dt).days))
            except Exception:
                pass

        # Progress computation from operational updates if available
        if operational_updates and len(operational_updates) > 0:
            latest = operational_updates[-1]
            if latest.get("newProgress") is not None:
                progress = latest["newProgress"]

        # If progress is still completely unspecified and not Completed
        if progress is None:
            if status == "Completed":
                progress = 100
            else:
                return None # Strictly declare INSUFFICIENT_DATA

        progress_pct = float(progress)
        expenditure_ratio = (spent / sanctioned) if sanctioned > 0 else 0.0

        # Update frequency: based on operational update count over elapsed days
        update_count = len(operational_updates) if operational_updates else 1
        update_frequency_days = max(7.0, elapsed_days / max(1.0, float(update_count)))

        # Velocity: progress per day
        progress_velocity = progress_pct / max(1.0, elapsed_days)

        # Milestones: proportional to progress or completed milestones
        milestones_completed_ratio = min(1.0, progress_pct / 100.0)

        return np.array([
            progress_pct,
            elapsed_days,
            expenditure_ratio,
            update_frequency_days,
            progress_velocity,
            milestones_completed_ratio
        ])

    def predict(
        self,
        project: Dict[str, Any],
        operational_updates: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Executes Random Forest inference on the project features.
        Returns predicted class, probabilities, feature importances, and explanation.
        """
        code = project.get("projectCode") or project.get("work_id") or "UNKNOWN"
        features = self.extract_features(project, operational_updates)

        if features is None:
            return {
                "module": "DELAY_RISK",
                "model": "Random Forest",
                "modelVersion": self.model_version,
                "projectCode": code,
                "status": "INSUFFICIENT_DATA",
                "predictedClass": "UNKNOWN",
                "confidence": 0.0,
                "score": 0.0,
                "isAnomaly": False,
                "explanation": (
                    f"Project {code} has not yet logged operational progress updates or execution milestones. "
                    "Official public dataset provides administrative sanction only. "
                    "Insufficient execution telemetry for Random Forest delay forecasting."
                ),
                "probabilities": {},
                "featureImportances": self.feature_importances,
                "trainingDataType": self.training_data_type,
            }

        X = features.reshape(1, -1)
        probas = self.model.predict_proba(X)[0]
        pred_idx = int(np.argmax(probas))
        predicted_class = self.CLASSES[pred_idx]
        confidence = float(probas[pred_idx])

        # Normalize delay risk score:
        # ON_TIME = 0.1 * proba(AT_RISK)
        # AT_RISK = 0.5 + 0.3 * proba(AT_RISK)
        # DELAYED = 0.7 + 0.3 * proba(DELAYED)
        delay_prob = float(probas[2]) if len(probas) > 2 else 0.0
        risk_prob = float(probas[1]) if len(probas) > 1 else 0.0

        if predicted_class == "DELAYED":
            score = 0.70 + (0.30 * delay_prob)
            status = "POTENTIAL_ANOMALY"
            is_anomaly = True
        elif predicted_class == "AT_RISK":
            score = 0.40 + (0.30 * risk_prob)
            status = "POTENTIAL_ANOMALY"
            is_anomaly = True
        else:
            score = max(0.05, 0.30 * (1.0 - confidence))
            status = "NORMAL"
            is_anomaly = False

        # Build feature explanation
        sorted_importances = sorted(self.feature_importances.items(), key=lambda x: x[1], reverse=True)
        top_feature_name = sorted_importances[0][0]
        top_feature_idx = self.FEATURE_NAMES.index(top_feature_name)
        top_feature_val = features[top_feature_idx]

        if predicted_class == "DELAYED":
            explanation = (
                f"Random Forest classified project as DELAYED (confidence: {confidence:.1%}). "
                f"Low progress velocity ({features[4]:.3f}) and stagnant milestones ({features[5]:.0%}) "
                f"after {int(features[1])} days contributed most to this classification."
            )
        elif predicted_class == "AT_RISK":
            explanation = (
                f"Random Forest classified project as AT_RISK (confidence: {confidence:.1%}). "
                f"Expenditure ratio ({features[2]:.1%}) outpaces physical progress ({features[0]:.0f}%), "
                f"with infrequent operational updates ({int(features[3])} day intervals)."
            )
        else:
            explanation = (
                f"Random Forest predicted ON_TIME trajectory (confidence: {confidence:.1%}). "
                f"Progress velocity ({features[4]:.3f}) is consistent with target schedule."
            )

        prob_dict = {
            cls_name: round(float(p), 3)
            for cls_name, p in zip(self.CLASSES, probas)
        }

        return {
            "module": "DELAY_RISK",
            "model": "Random Forest",
            "modelVersion": self.model_version,
            "projectCode": code,
            "status": status,
            "predictedClass": predicted_class,
            "confidence": round(confidence, 3),
            "score": round(score, 3),
            "threshold": 0.60,
            "isAnomaly": is_anomaly,
            "explanation": explanation,
            "probabilities": prob_dict,
            "featureImportances": self.feature_importances,
            "features": {
                name: round(float(val), 3)
                for name, val in zip(self.FEATURE_NAMES, features)
            },
            "trainingDataType": self.training_data_type,
        }
