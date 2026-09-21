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

    def test_discovers_direct_tree_and_tip_folders(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            analysis = root / "Ahyacinthus"
            tip_folder = analysis / "S1_Acropora_sp2_Keelung_Waimushan"
            tip_folder.mkdir(parents=True)
            (analysis / "analysis.tree").write_text("(S1_Acropora_sp2_Keelung_Waimushan:1,Other:1);", encoding="utf-8")
            (tip_folder / "photo.jpg").write_bytes(b"photo")
            datasets, errors = server.discover_datasets(root)
            self.assertEqual(errors, {})
            self.assertEqual(datasets[0]["id"], "Ahyacinthus")
            payload = server.dataset_payload("Ahyacinthus", root)
            self.assertEqual(payload["photoFolders"]["S1_Acropora_sp2_Keelung_Waimushan"][0]["name"], "photo.jpg")

    def test_rejects_paths_outside_data_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset = root / "datasets" / "unsafe"
            dataset.mkdir(parents=True)
            (dataset / "dataset.json").write_text(json.dumps({"tree": "../../../tree.nwk", "photos": "photos"}), encoding="utf-8")
            _, errors = server.discover_datasets(root)
            self.assertIn("leaves the configured data root", errors["unsafe"])

    def test_lexical_rename_changes_only_leaf_labels(self):
        source = "#NEXUS\nBegin trees;\nTranslate 1 A, 2 B;\nTree t = [&R] (1:0.1,2:0.2)95:0.3;\nEnd;\n"
        updated, changes = server.lexical_rename(source, [{"from": "A", "to": "A_new"}])
        self.assertEqual(len(changes), 1)
        self.assertIn("Translate 1 A_new, 2 B;", updated)
        self.assertIn("(1:0.1,2:0.2)95:0.3;", updated)
        self.assertEqual(updated.replace("A_new", "A"), source)

    def test_edit_commit_sync_folders_and_writes_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            analysis = root / "analysis"
            (analysis / "A").mkdir(parents=True)
            (analysis / "A" / "one.jpg").write_bytes(b"photo")
            (analysis / "tree.nwk").write_text("(A:1,B:1)95:2;\n", encoding="utf-8")
            preview = server.preview_rename("analysis", [{"from": "A", "to": "A-renamed"}], root)
            result = server.commit_rename("analysis", [{"from": "A", "to": "A-renamed"}], root)
            self.assertIn("A-renamed", preview["updated"])
            self.assertTrue((analysis / "A-renamed" / "one.jpg").is_file())
            self.assertFalse((analysis / "A").exists())
            history = (analysis / "rename-history.txt").read_text(encoding="utf-8")
            self.assertIn("A -> A-renamed", history)

    def test_tip_folder_creation_is_available(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            analysis = root / "analysis"
            analysis.mkdir()
            (analysis / "tree.nwk").write_text("(A:1,B:1);", encoding="utf-8")
            result = server.create_tip_folders("analysis", root)
            self.assertEqual(result["created"], ["A", "B"])
            self.assertTrue((analysis / "A").is_dir())
            self.assertTrue((analysis / "B").is_dir())

    def test_tip_folder_creation_uses_nexus_translate_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            analysis = root / "analysis"
            analysis.mkdir()
            (analysis / "tree.nex").write_text("#NEXUS\nBegin trees;\nTranslate 1 'A sample', 2 B;\nTree t = (1:1,2:1);\nEnd;", encoding="utf-8")
            result = server.create_tip_folders("analysis", root)
            self.assertEqual(result["created"], ["A sample", "B"])
            self.assertTrue((analysis / "A sample").is_dir())


if __name__ == "__main__":
    unittest.main()
