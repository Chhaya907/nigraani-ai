import unittest
import numpy as np
from PIL import Image, ImageDraw
import io
import base64

from models.duplicate_detector import DuplicateWorkDetector
from models.fund_movement_detector import FundMovementDetector
from models.delay_risk_detector import DelayRiskDetector
from models.image_reuse_detector import EvidenceReuseDetector

class TestNigraaniMlModels(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        print("\n==================================================")
        print("INITIALIZING REAL ML MODELS FOR UNIT TESTING")
        print("==================================================")
        cls.dup_detector = DuplicateWorkDetector()
        cls.fund_detector = FundMovementDetector()
        cls.delay_detector = DelayRiskDetector()
        cls.evidence_detector = EvidenceReuseDetector()

    # --------------------------------------------------------------------------
    # MODEL 1: DUPLICATE WORK (SEMANTIC SIMILARITY) TESTS
    # --------------------------------------------------------------------------
    def test_01_embedding_generation(self):
        """Verifies real dense embeddings are generated with unit norm."""
        texts = ["Installation of piped drinking water distribution network in Pati block."]
        embeddings = self.dup_detector.embed_texts(texts)
        self.assertEqual(embeddings.shape[0], 1)
        self.assertGreater(embeddings.shape[1], 100) # Transformer embedding dimension
        norm = np.linalg.norm(embeddings[0])
        self.assertAlmostEqual(norm, 1.0, places=4)

    def test_02_semantic_similarity_relative_ordering(self):
        """Proves similar project descriptions yield higher cosine similarity than unrelated ones."""
        p_water_1 = {
            "projectCode": "PROJ-W-1",
            "title": "Community RO water filtration plant and pipeline",
            "description": "Installation of 50000 litre overhead tank and RO filter unit",
            "district": "Barwani",
            "state": "Madhya Pradesh"
        }
        p_water_2 = {
            "projectCode": "PROJ-W-2",
            "title": "Drinking water supply and RO filtration system",
            "description": "Construction of water purification plant and distribution network",
            "district": "Barwani",
            "state": "Madhya Pradesh"
        }
        p_road = {
            "projectCode": "PROJ-R-1",
            "title": "Bitumen road construction in hilly tribal hamlets",
            "description": "2.4 km tar road with stone retaining wall and drainage culverts",
            "district": "Pune",
            "state": "Maharashtra"
        }

        res_similar = self.dup_detector.compare_pair(p_water_1, p_water_2)
        res_dissimilar = self.dup_detector.compare_pair(p_water_1, p_road)

        self.assertGreater(res_similar["score"], res_dissimilar["score"])
        self.assertGreater(res_similar["score"], 0.70)
        self.assertLess(res_dissimilar["score"], 0.60)
        self.assertEqual(res_similar["status"], "POTENTIAL_ANOMALY")
        self.assertEqual(res_dissimilar["status"], "NORMAL")

    # --------------------------------------------------------------------------
    # MODEL 2: FUND MOVEMENT (ISOLATION FOREST) TESTS
    # --------------------------------------------------------------------------
    def test_03_isolation_forest_instantiation_and_prediction(self):
        """Verifies scikit-learn IsolationForest is fitted and predicts anomalies."""
        self.assertTrue(self.fund_detector.is_trained)
        self.assertEqual(self.fund_detector.training_data_type, "DEMO_AUGMENTATION")

        # Normal project with gradual vouchers
        normal_project = {"projectCode": "NORM-01", "sanctionedAmount": 5000000.0, "spentAmount": 2500000.0}
        normal_exp = [
            {"amount": 500000.0, "voucherNo": "V1"},
            {"amount": 1000000.0, "voucherNo": "V2"},
            {"amount": 1000000.0, "voucherNo": "V3"},
        ]
        res_normal = self.fund_detector.predict(normal_project, normal_exp)
        self.assertIn(res_normal["status"], ["NORMAL", "POTENTIAL_ANOMALY"])
        self.assertIsInstance(res_normal["score"], float)
        self.assertIn("topDriver", res_normal)

    def test_04_fund_movement_insufficient_data(self):
        """Verifies that sparse official records return INSUFFICIENT_DATA without fake values."""
        sparse_project = {"projectCode": "SPARSE-01", "sanctionedAmount": 5000000.0, "spentAmount": 2500000.0}
        # Only 1 aggregate expenditure
        res = self.fund_detector.predict(sparse_project, [{"amount": 2500000.0}])
        self.assertEqual(res["status"], "INSUFFICIENT_DATA")
        self.assertFalse(res["isAnomaly"])
        self.assertIn("Insufficient data", res["explanation"])

    # --------------------------------------------------------------------------
    # MODEL 3: DELAY RISK (RANDOM FOREST) TESTS
    # --------------------------------------------------------------------------
    def test_05_random_forest_training_and_feature_importances(self):
        """Verifies scikit-learn RandomForestClassifier yields real feature importances."""
        self.assertTrue(self.delay_detector.is_trained)
        importances = self.delay_detector.feature_importances
        self.assertEqual(len(importances), 6)
        # Sum of MDI feature importances in scikit-learn equals 1.0
        total_importance = sum(importances.values())
        self.assertAlmostEqual(total_importance, 1.0, places=2)

    def test_06_random_forest_classification(self):
        """Verifies Random Forest classifies distinct trajectories into ON_TIME vs DELAYED."""
        on_time_project = {
            "projectCode": "ON-TIME-01",
            "progress": 90,
            "sanctionedAmount": 10000000.0,
            "spentAmount": 8500000.0,
            "startDate": "2024-01-01T00:00:00Z"
        }
        res_ontime = self.delay_detector.predict(on_time_project, [{"newProgress": 90}])
        self.assertEqual(res_ontime["predictedClass"], "ON_TIME")
        self.assertGreater(res_ontime["confidence"], 0.5)

        delayed_project = {
            "projectCode": "DELAYED-01",
            "progress": 15,
            "sanctionedAmount": 10000000.0,
            "spentAmount": 8500000.0, # High spend, very low progress -> Delayed
            "startDate": "2023-01-01T00:00:00Z"
        }
        res_delayed = self.delay_detector.predict(delayed_project, [{"newProgress": 15}])
        self.assertIn(res_delayed["predictedClass"], ["DELAYED", "AT_RISK"])
        self.assertTrue(res_delayed["isAnomaly"])

    # --------------------------------------------------------------------------
    # MODEL 4: EVIDENCE REUSE (PERCEPTUAL HASHING) TESTS
    # --------------------------------------------------------------------------
    def test_07_perceptual_hashing_and_hamming_distance(self):
        """Verifies perceptual hashing detects identical/slightly cropped images and separates distinct ones."""
        # Create image 1: red rectangle on white
        img1 = Image.new("RGB", (200, 200), color="white")
        draw1 = ImageDraw.Draw(img1)
        draw1.rectangle([30, 30, 170, 170], fill="red")

        # Create image 2: slight perturbation of image 1 (subtle crop/shift)
        img2 = Image.new("RGB", (200, 200), color="white")
        draw2 = ImageDraw.Draw(img2)
        draw2.rectangle([32, 32, 172, 172], fill="red")

        # Create image 3: completely different pattern (blue diagonal stripes)
        img3 = Image.new("RGB", (200, 200), color="blue")
        draw3 = ImageDraw.Draw(img3)
        draw3.line([0, 0, 200, 200], fill="yellow", width=20)

        h1 = self.evidence_detector.compute_hashes_from_image(img1)["perceptualHash"]
        h2 = self.evidence_detector.compute_hashes_from_image(img2)["perceptualHash"]
        h3 = self.evidence_detector.compute_hashes_from_image(img3)["perceptualHash"]

        dist_similar, sim_similar = self.evidence_detector.compare_hashes(h1, h2)
        dist_different, sim_different = self.evidence_detector.compare_hashes(h1, h3)

        self.assertLess(dist_similar, 6) # Nearly identical
        self.assertGreater(sim_similar, 0.90)
        self.assertGreater(dist_different, 15) # Vastly distinct
        self.assertLess(sim_different, 0.75)

    def test_08_evidence_reuse_insufficient_data(self):
        """Verifies that an empty corpus returns INSUFFICIENT_DATA."""
        target = {"evidenceCode": "EV-01", "projectCode": "P-01", "perceptualHash": "ffff0000ffff0000"}
        res = self.evidence_detector.scan_for_reuse(target, [])
        self.assertEqual(res["status"], "INSUFFICIENT_DATA")
        self.assertFalse(res["isAnomaly"])

if __name__ == "__main__":
    unittest.main()
