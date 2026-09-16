import json
import tempfile
import unittest
from pathlib import Path

from client import server


class DatasetTests(unittest.TestCase):
    def make_dataset(self, root: Path, dataset_id: str = "analysis-a") -> Path:
        dataset = root / "datasets" / dataset_id
        photos = dataset / "photos" / "A_sample"
        photos.mkdir(parents=True)
        (dataset / "tree.nwk").write_text("(A_sample:1,B_sample:1);", encoding="utf-8")
        (photos / "one.jpg").write_bytes(b"photo")
        (dataset / "metadata.csv").write_text("tip,note\nA_sample,test\n", encoding="utf-8")
        (dataset / "dataset.json").write_text(json.dumps({
            "title": "Analysis A",
            "tree": "tree.nwk",
            "photos": "photos",
            "metadata": "metadata.csv",
        }), encoding="utf-8")
        return dataset

    def test_discovers_and_indexes_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_dataset(root)
            datasets, errors = server.discover_datasets(root)
            self.assertEqual(errors, {})
            self.assertEqual(datasets[0]["id"], "analysis-a")
            payload = server.dataset_payload("analysis-a", root)
            self.assertEqual(payload["tree"]["filename"], "tree.nwk")
            self.assertEqual(payload["photoFolders"]["A_sample"][0]["name"], "one.jpg")
            self.assertIsNotNone(payload["metadata"])

    def test_auto_detects_single_tree_without_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset = root / "datasets" / "automatic"
            (dataset / "photos").mkdir(parents=True)
            (dataset / "only.tree").write_text("(A,B);", encoding="utf-8")
            datasets, errors = server.discover_datasets(root)
            self.assertEqual(errors, {})
            self.assertEqual(datasets[0]["treeFile"], "only.tree")

    def test_rejects_paths_outside_data_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset = root / "datasets" / "unsafe"
            dataset.mkdir(parents=True)
            (dataset / "dataset.json").write_text(json.dumps({"tree": "../../../tree.nwk", "photos": "photos"}), encoding="utf-8")
            _, errors = server.discover_datasets(root)
            self.assertIn("leaves the configured data root", errors["unsafe"])


if __name__ == "__main__":
    unittest.main()
