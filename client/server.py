#!/usr/bin/env python3
"""Serve PhyloPhoto datasets and explicitly gated NAS editing operations."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import uuid
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

CLIENT_ROOT = Path(__file__).resolve().parent
UPLOAD_ROOT = Path(os.environ.get("PHYLOPHOTO_UPLOAD_ROOT", "/uploads")).resolve()
DATA_ROOT = Path(os.environ.get("PHYLOPHOTO_DATA_ROOT", "/data")).resolve()
DATASET_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
TREE_EXTENSIONS = {".nwk", ".newick", ".tree", ".tre", ".nex", ".nexus"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp", ".avif", ".heic", ".heif"}
EDITING_ENABLED = os.environ.get("PHYLOPHOTO_ENABLE_EDITING", "0").lower() in {"1", "true", "yes", "on"}


class DatasetError(ValueError):
    pass


def inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def safe_path(base: Path, value: str, data_root: Path, kind: str) -> Path:
    path = (base / value).resolve()
    if not inside(path, data_root):
        raise DatasetError(f"{kind} path leaves the configured data root")
    return path


def read_manifest(dataset_dir: Path, data_root: Path) -> dict:
    manifest_path = dataset_dir / "dataset.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise DatasetError(f"Invalid dataset.json: {exc}") from exc
    else:
        manifest = {}
    if manifest.get("tree"):
        tree_path = safe_path(dataset_dir, str(manifest["tree"]), data_root, "Tree")
    else:
        candidates = sorted(path for path in dataset_dir.iterdir() if path.is_file() and path.suffix.lower() in TREE_EXTENSIONS)
        if len(candidates) != 1:
            raise DatasetError("Specify 'tree' in dataset.json or keep exactly one tree file in the dataset folder")
        tree_path = candidates[0].resolve()
    if not inside(tree_path, data_root):
        raise DatasetError("Tree path leaves the configured data root")
    photos_path = safe_path(dataset_dir, str(manifest.get("photos", ".")), data_root, "Photos")
    metadata_value = manifest.get("metadata")
    metadata_path = safe_path(dataset_dir, str(metadata_value), data_root, "Metadata") if metadata_value else None
    if not tree_path.is_file():
        raise DatasetError(f"Tree file not found: {tree_path.name}")
    if not photos_path.is_dir():
        raise DatasetError(f"Photo folder not found: {photos_path.name}")
    if metadata_path and not metadata_path.is_file():
        raise DatasetError(f"Metadata file not found: {metadata_path.name}")
    return {"title": str(manifest.get("title") or dataset_dir.name), "tree": tree_path, "photos": photos_path, "metadata": metadata_path}


def dataset_roots(data_root: Path | None = None) -> list[Path]:
    if data_root is not None:
        return [data_root.resolve()]
    return list(dict.fromkeys([DATA_ROOT, UPLOAD_ROOT]))


def dataset_directories(root: Path) -> list[Path]:
    direct = sorted(path for path in root.iterdir() if path.is_dir() and path.name != "datasets" and DATASET_ID.fullmatch(path.name)) if root.is_dir() else []
    legacy_root = root / "datasets"
    legacy = sorted(path for path in legacy_root.iterdir() if path.is_dir() and DATASET_ID.fullmatch(path.name)) if legacy_root.is_dir() else []
    return direct + legacy


def discover_datasets(data_root: Path | None = None) -> tuple[list[dict], dict[str, str]]:
    datasets, errors = [], {}
    seen = set()
    for root in dataset_roots(data_root):
        for dataset_dir in dataset_directories(root):
            if dataset_dir.name in seen:
                errors[dataset_dir.name] = "Duplicate dataset id"
                continue
            seen.add(dataset_dir.name)
            try:
                config = read_manifest(dataset_dir, root)
                datasets.append({"id": dataset_dir.name, "title": config["title"], "treeFile": config["tree"].name})
            except (DatasetError, OSError) as exc:
                errors[dataset_dir.name] = str(exc)
    return datasets, errors


def get_dataset(dataset_id: str, data_root: Path | None = None) -> dict:
    if not DATASET_ID.fullmatch(dataset_id):
        raise DatasetError("Invalid dataset id")
    for root in dataset_roots(data_root):
        for candidate in (root / dataset_id, root / "datasets" / dataset_id):
            dataset_dir = candidate.resolve()
            if inside(dataset_dir, root) and dataset_dir.is_dir():
                return read_manifest(dataset_dir, root)
    raise DatasetError("Dataset not found")


def dataset_payload(dataset_id: str, data_root: Path | None = None) -> dict:
    config = get_dataset(dataset_id, data_root)
    encoded_id = quote(dataset_id, safe="")
    photo_folders = {}
    for folder in sorted(path for path in config["photos"].iterdir() if path.is_dir() and not path.name.startswith(".")):
        photos = []
        image_paths = sorted(path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)
        for image_path in image_paths:
            relative = image_path.relative_to(folder).as_posix()
            url_path = "/".join(quote(part, safe="") for part in relative.split("/"))
            photos.append({"name": image_path.name, "path": f"{folder.name}/{relative}", "url": f"/api/datasets/{encoded_id}/photos/{quote(folder.name, safe='')}/{url_path}", "type": mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"})
        photo_folders[folder.name] = photos
    return {
        "id": dataset_id,
        "title": config["title"],
        "tree": {"filename": config["tree"].name, "url": f"/api/datasets/{encoded_id}/tree"},
        "metadata": {"filename": config["metadata"].name, "url": f"/api/datasets/{encoded_id}/metadata"} if config["metadata"] else None,
        "photoFolders": photo_folders,
    }


def _tree_span(source: str) -> tuple[int, int]:
    start = source.find("(")
    if start < 0:
        raise DatasetError("No Newick tree was found in the file")
    depth = 0
    quoted = False
    comment_depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if quoted:
            if char == "'":
                if index + 1 < len(source) and source[index + 1] == "'":
                    continue
                quoted = False
            continue
        if comment_depth:
            if char == "]":
                comment_depth -= 1
            continue
        if char == "'":
            quoted = True
        elif char == "[":
            comment_depth += 1
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == ";" and depth == 0:
            return start, index + 1
    raise DatasetError("The tree statement is incomplete")


def _quoted_token(source: str, start: int) -> tuple[int, int, str]:
    if source[start] != "'":
        end = start
        while end < len(source) and source[end] not in "(),:;[]\t\r\n ":
            end += 1
        return start, end, source[start:end]
    end = start + 1
    value = []
    while end < len(source):
        if source[end] == "'":
            if end + 1 < len(source) and source[end + 1] == "'":
                value.append("'")
                end += 2
                continue
            return start, end + 1, "".join(value)
        value.append(source[end])
        end += 1
    raise DatasetError("Unclosed quoted tree label")


def _leaf_label_spans(newick: str) -> list[tuple[int, int, str]]:
    spans = []
    index = 0
    expect_label = True
    while index < len(newick):
        char = newick[index]
        if char.isspace() or char in "[]":
            if char == "[":
                end = newick.find("]", index + 1)
                index = len(newick) if end < 0 else end + 1
            else:
                index += 1
            continue
        if char == "(":
            expect_label = True
            index += 1
            continue
        if char == ",":
            expect_label = True
            index += 1
            continue
        if char == ")":
            expect_label = False
            index += 1
            continue
        if char == ":":
            index += 1
            while index < len(newick) and newick[index] not in ",);":
                index += 1
            continue
        if char == ";":
            break
        start, end, label = _quoted_token(newick, index)
        if expect_label:
            spans.append((start, end, label))
        index = end
        expect_label = False
    return spans


def _translate_spans(source: str) -> list[tuple[int, int, str]]:
    match = re.search(r"\btranslate\b(.*?);", source, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return []
    spans = []
    body_start = match.start(1)
    index = 0
    while index < len(match.group(1)):
        if match.group(1)[index].isspace() or match.group(1)[index] == ",":
            index += 1
            continue
        _, key_end, _ = _quoted_token(match.group(1), index)
        index = key_end
        while index < len(match.group(1)) and match.group(1)[index].isspace():
            index += 1
        if index >= len(match.group(1)):
            break
        start, end, label = _quoted_token(match.group(1), index)
        spans.append((body_start + start, body_start + end, label))
        index = end
    return spans


def _translate_map(source: str) -> dict[str, str]:
    match = re.search(r"\btranslate\b(.*?);", source, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return {}
    mapping = {}
    index = 0
    body = match.group(1)
    while index < len(body):
        if body[index].isspace() or body[index] == ",":
            index += 1
            continue
        _, key_end, key = _quoted_token(body, index)
        index = key_end
        while index < len(body) and body[index].isspace():
            index += 1
        if index >= len(body):
            break
        _, value_end, value = _quoted_token(body, index)
        mapping[key] = value
        index = value_end
    return mapping


def lexical_rename(source: str, operations: list[dict]) -> tuple[str, list[dict]]:
    """Rename only leaf labels while preserving all non-label source bytes."""
    start, end = _tree_span(source)
    tree = source[start:end]
    translate_spans = _translate_spans(source)
    spans = translate_spans or [(start + left, start + right, label) for left, right, label in _leaf_label_spans(tree)]
    by_old = {str(item.get("from", "")): str(item.get("to", "")) for item in operations}
    if len(by_old) != len(operations):
        raise DatasetError("Rename sources must be unique")
    if any(not old or not new for old, new in by_old.items()):
        raise DatasetError("Rename labels cannot be empty")
    changes = []
    replacements = []
    seen_new = set()
    for left, right, label in spans:
        if label not in by_old:
            continue
        new = by_old[label]
        if new in seen_new or (new != label and new in {candidate[2] for candidate in spans} and new not in by_old):
            raise DatasetError(f"Rename target already exists: {new}")
        seen_new.add(new)
        old_text = source[left:right]
        if old_text.startswith("'"):
            replacement = "'" + new.replace("'", "''") + "'"
        else:
            if re.search(r"[\\s(),:;\\[\\]'\\\\]", new):
                replacement = "'" + new.replace("'", "''") + "'"
            else:
                replacement = new
        replacements.append((left, right, replacement))
        changes.append({"from": label, "to": new, "start": left, "end": right})
    if len({item["to"] for item in changes}) != len(changes):
        raise DatasetError("Rename targets must be unique")
    updated = source
    for left, right, replacement in reversed(replacements):
        updated = updated[:left] + replacement + updated[right:]
    return updated, changes


def _editing_required() -> None:
    if not EDITING_ENABLED:
        raise DatasetError("NAS editing is disabled; set PHYLOPHOTO_ENABLE_EDITING=1 to enable it")


def _validate_folder_name(name: str) -> str:
    value = str(name)
    if not value or value in {".", ".."} or Path(value).name != value or "\x00" in value or "/" in value or "\\" in value:
        raise DatasetError("Invalid tip folder name")
    return value


def _backup_root(data_root: Path, dataset_id: str) -> Path:
    root = data_root / ".phylophoto-backups" / dataset_id
    if not inside(root.resolve(), data_root.resolve()):
        raise DatasetError("Invalid backup path")
    return root


def _make_backup(config: dict, dataset_id: str, data_root: Path, folders: list[str], targets: list[str] | None = None) -> str:
    backup_id = f"{datetime.now().strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:8]}"
    backup = _backup_root(data_root, dataset_id) / backup_id
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(config["tree"], backup / config["tree"].name)
    copied = []
    for name in folders:
        source = config["photos"] / name
        if source.is_dir():
            shutil.copytree(source, backup / "folders" / name)
            copied.append(name)
    (backup / "backup.json").write_text(json.dumps({"dataset": dataset_id, "tree": config["tree"].name, "folders": copied, "targets": targets or []}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return backup_id


def preview_rename(dataset_id: str, operations: list[dict], data_root: Path | None = None) -> dict:
    _editing_required()
    config = get_dataset(dataset_id, data_root)
    root = next(path for path in dataset_roots(data_root) if inside(config["tree"], path))
    raw = config["tree"].read_text(encoding="utf-8")
    updated, changes = lexical_rename(raw, operations)
    folder_changes = []
    for item in operations:
        old, new = _validate_folder_name(item["from"]), _validate_folder_name(item["to"])
        old_path, new_path = config["photos"] / old, config["photos"] / new
        if old_path.exists() and not old_path.is_dir():
            raise DatasetError(f"Tip folder is not a directory: {old}")
        if old_path.is_dir() and new_path.exists() and old != new:
            raise DatasetError(f"Destination folder already exists: {new}")
        folder_changes.append({"from": old, "to": new, "exists": old_path.is_dir(), "conflict": new_path.exists() and old != new})
    return {"dataset": dataset_id, "treeFilename": config["tree"].name, "original": raw, "updated": updated, "changes": changes, "folders": folder_changes, "backupRoot": str(_backup_root(root, dataset_id))}


def commit_rename(dataset_id: str, operations: list[dict], data_root: Path | None = None) -> dict:
    preview = preview_rename(dataset_id, operations, data_root)
    if not preview["changes"]:
        raise DatasetError("No matching leaf labels were found")
    config = get_dataset(dataset_id, data_root)
    root = next(path for path in dataset_roots(data_root) if inside(config["tree"], path))
    folder_names = [item["from"] for item in preview["folders"] if item["exists"]]
    folder_targets = [item["to"] for item in preview["folders"] if item["exists"] and item["from"] != item["to"]]
    backup_id = _make_backup(config, dataset_id, root, folder_names, folder_targets)
    moved: list[tuple[Path, Path]] = []
    temp_tree = config["tree"].with_name(f".{config['tree'].name}.{uuid.uuid4().hex}.tmp")
    try:
        for item in preview["folders"]:
            if not item["exists"] or item["from"] == item["to"]:
                continue
            source, target = config["photos"] / item["from"], config["photos"] / item["to"]
            temporary = config["photos"] / f".{item['from']}.{uuid.uuid4().hex}.rename"
            source.rename(temporary)
            temporary.rename(target)
            moved.append((target, source))
        temp_tree.write_text(preview["updated"], encoding="utf-8")
        os.replace(temp_tree, config["tree"])
    except Exception:
        if temp_tree.exists():
            temp_tree.unlink()
        for target, source in reversed(moved):
            if target.exists() and not source.exists():
                target.rename(source)
        raise
    return {"dataset": dataset_id, "backupId": backup_id, "changes": preview["changes"], "folders": preview["folders"]}


def create_tip_folders(dataset_id: str, data_root: Path | None = None) -> dict:
    _editing_required()
    config = get_dataset(dataset_id, data_root)
    raw = config["tree"].read_text(encoding="utf-8")
    _, _ = lexical_rename(raw, [])
    start, end = _tree_span(raw)
    translation_map = _translate_map(raw)
    labels = [translation_map.get(label, label) for _, _, label in _leaf_label_spans(raw[start:end])]
    missing = []
    for label in labels:
        name = _validate_folder_name(label)
        target = config["photos"] / name
        if target.exists() and not target.is_dir():
            raise DatasetError(f"Tip path is not a directory: {name}")
        if not target.exists():
            missing.append(name)
    created = []
    try:
        for name in missing:
            (config["photos"] / name).mkdir()
            created.append(name)
    except OSError:
        for name in reversed(created):
            (config["photos"] / name).rmdir()
        raise
    return {"dataset": dataset_id, "created": created, "existing": [label for label in labels if label not in created]}


def rollback_dataset(dataset_id: str, backup_id: str, data_root: Path | None = None) -> dict:
    _editing_required()
    if not re.fullmatch(r"[A-Za-z0-9T_-]+", backup_id):
        raise DatasetError("Invalid backup id")
    config = get_dataset(dataset_id, data_root)
    root = next(path for path in dataset_roots(data_root) if inside(config["tree"], path))
    backup = _backup_root(root, dataset_id) / backup_id
    manifest_path = backup / "backup.json"
    if not inside(backup.resolve(), _backup_root(root, dataset_id).resolve()) or not manifest_path.is_file():
        raise DatasetError("Backup not found")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    original_tree = backup / str(manifest.get("tree") or "")
    if not original_tree.is_file():
        raise DatasetError("Backup tree is missing")
    for name in manifest.get("folders", []):
        _validate_folder_name(name)
    for name in manifest.get("targets", []):
        _validate_folder_name(name)
    tree_temp = config["tree"].with_name(f".{config['tree'].name}.{uuid.uuid4().hex}.rollback")
    try:
        shutil.copy2(original_tree, tree_temp)
        os.replace(tree_temp, config["tree"])
        for name in manifest.get("targets", []):
            target = config["photos"] / name
            if target.exists():
                shutil.rmtree(target)
        for name in manifest.get("folders", []):
            source = backup / "folders" / name
            target = config["photos"] / name
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)
    finally:
        if tree_temp.exists():
            tree_temp.unlink()
    return {"dataset": dataset_id, "backupId": backup_id, "restored": manifest.get("folders", [])}


class Handler(SimpleHTTPRequestHandler):
    server_version = "PhyloPhoto/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CLIENT_ROOT), **kwargs)

    def end_headers(self) -> None:
        """Avoid mixed cached HTML/JS/CSS versions after a NAS rebuild."""
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0, must-revalidate")
        super().end_headers()

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_path(self, path: Path, cache: bool = False) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        stat = path.stat()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-store")
        self.end_headers()
        if self.command != "HEAD":
            with path.open("rb") as source:
                self.copyfile(source, self.wfile)


    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 65536:
            raise DatasetError("Invalid JSON request size")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DatasetError("Invalid JSON request") from exc

    def create_upload_dataset(self, dataset_id: str) -> None:
        if not DATASET_ID.fullmatch(dataset_id):
            raise DatasetError("Invalid dataset id")
        body = self.read_json_body()
        append = bool(body.get("append"))
        dataset_dir = (UPLOAD_ROOT / dataset_id).resolve()
        if not inside(dataset_dir, UPLOAD_ROOT):
            raise DatasetError("Invalid upload path")
        if append:
            if not dataset_dir.is_dir():
                raise DatasetError("NAS folder not found")
            self.send_json({"id": dataset_id})
            return
        if dataset_dir.exists():
            raise DatasetError("A NAS folder with this name already exists")
        tree_name = str(body.get("tree") or "")
        metadata_name = str(body.get("metadata") or "")
        if not tree_name or Path(tree_name).name != tree_name or Path(tree_name).suffix.lower() not in TREE_EXTENSIONS:
            raise DatasetError("Invalid tree filename")
        if metadata_name and (Path(metadata_name).name != metadata_name or Path(metadata_name).suffix.lower() != ".csv"):
            raise DatasetError("Invalid metadata filename")
        dataset_dir.mkdir(parents=True, exist_ok=True)
        manifest = {"tree": tree_name, "photos": "."}
        if metadata_name: manifest["metadata"] = metadata_name
        temporary = dataset_dir / ".dataset.json.uploading"
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(dataset_dir / "dataset.json")
        self.send_json({"id": dataset_id}, HTTPStatus.CREATED)

    def upload_file(self, dataset_id: str, kind: str, relative: str) -> None:
        if not DATASET_ID.fullmatch(dataset_id):
            raise DatasetError("Invalid dataset id")
        dataset_dir = (UPLOAD_ROOT / dataset_id).resolve()
        if not inside(dataset_dir, UPLOAD_ROOT) or not dataset_dir.is_dir():
            raise DatasetError("NAS folder not found")
        relative = unquote(relative).lstrip("/")
        if kind in {"tree", "metadata"} and Path(relative).name != relative:
            raise DatasetError("Invalid filename")
        if kind == "tree" and Path(relative).suffix.lower() not in TREE_EXTENSIONS:
            raise DatasetError("Invalid tree file")
        if kind == "metadata" and Path(relative).suffix.lower() != ".csv":
            raise DatasetError("Invalid metadata file")
        if kind == "photos" and Path(relative).suffix.lower() not in IMAGE_EXTENSIONS:
            raise DatasetError("Invalid photo file")
        base = dataset_dir
        target = (base / relative).resolve()
        if not inside(target, dataset_dir):
            raise DatasetError("Invalid upload path")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0:
            raise DatasetError("Invalid upload size")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.uploading")
        try:
            remaining = length
            with temporary.open("wb") as output:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk: raise OSError("Upload ended early")
                    output.write(chunk); remaining -= len(chunk)
            temporary.replace(target)
        finally:
            if temporary.exists(): temporary.unlink()
        self.send_response(HTTPStatus.NO_CONTENT); self.end_headers()
    def api(self, path: str) -> bool:
        if path == "/api/capabilities":
            self.send_json({"editing": EDITING_ENABLED, "language": ["en", "zh-Hant"]})
            return True
        if path == "/api/datasets":
            datasets, errors = discover_datasets()
            self.send_json({"datasets": datasets, "errors": errors})
            return True
        match = re.fullmatch(r"/api/datasets/([^/]+)", path)
        if match:
            self.send_json(dataset_payload(unquote(match.group(1))))
            return True
        match = re.fullmatch(r"/api/datasets/([^/]+)/(tree|metadata)", path)
        if match:
            config = get_dataset(unquote(match.group(1)))
            target = config[match.group(2)]
            if target is None:
                raise DatasetError("Metadata is not configured")
            self.send_path(target)
            return True
        match = re.fullmatch(r"/api/datasets/([^/]+)/photos/([^/]+)/(.*)", path)
        if match:
            config = get_dataset(unquote(match.group(1)))
            target = (config["photos"] / unquote(match.group(2)) / unquote(match.group(3))).resolve()
            if not inside(target, config["photos"].resolve()) or target.suffix.lower() not in IMAGE_EXTENSIONS:
                raise DatasetError("Invalid photo path")
            self.send_path(target, cache=True)
            return True
        return False

    def handle_request(self) -> None:
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            super().do_GET() if self.command == "GET" else super().do_HEAD()
            return
        try:
            if not self.api(path):
                self.send_json({"error": "API endpoint not found"}, HTTPStatus.NOT_FOUND)
        except DatasetError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except OSError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


    def handle_upload(self) -> None:
        path = urlparse(self.path).path
        try:
            match = re.fullmatch(r"/api/admin/datasets/([^/]+)", path)
            if self.command == "POST" and match:
                self.create_upload_dataset(unquote(match.group(1))); return
            match = re.fullmatch(r"/api/admin/datasets/([^/]+)/files/(tree|metadata|photos)/(.*)", path)
            if self.command == "PUT" and match:
                self.upload_file(unquote(match.group(1)), match.group(2), match.group(3)); return
            match = re.fullmatch(r"/api/admin/datasets/([^/]+)/rename/(preview|commit)", path)
            if self.command == "POST" and match:
                body = self.read_json_body()
                operations = body.get("operations")
                if not isinstance(operations, list):
                    raise DatasetError("Rename operations must be a list")
                result = preview_rename(unquote(match.group(1)), operations) if match.group(2) == "preview" else commit_rename(unquote(match.group(1)), operations)
                self.send_json(result, HTTPStatus.OK if match.group(2) == "preview" else HTTPStatus.CREATED)
                return
            match = re.fullmatch(r"/api/admin/datasets/([^/]+)/tip-folders", path)
            if self.command == "POST" and match:
                self.send_json(create_tip_folders(unquote(match.group(1))), HTTPStatus.CREATED)
                return
            match = re.fullmatch(r"/api/admin/datasets/([^/]+)/rollback", path)
            if self.command == "POST" and match:
                body = self.read_json_body()
                result = rollback_dataset(unquote(match.group(1)), str(body.get("backupId") or ""))
                self.send_json(result)
                return
            self.send_json({"error": "Upload endpoint not found"}, HTTPStatus.NOT_FOUND)
        except DatasetError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except OSError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:  # noqa: N802
        self.handle_upload()

    def do_PUT(self) -> None:  # noqa: N802
        self.handle_upload()
    def do_GET(self) -> None:  # noqa: N802
        self.handle_request()

    def do_HEAD(self) -> None:  # noqa: N802
        self.handle_request()


if __name__ == "__main__":
    host = os.environ.get("BIND_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "80"))
    print(f"PhyloPhoto serving on {host}:{port}; data root: {DATA_ROOT}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
