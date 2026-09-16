#!/usr/bin/env python3
"""Serve PhyloPhoto and read-only datasets stored on the NAS."""

from __future__ import annotations

import json
import mimetypes
import os
import re
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
    for folder in sorted(path for path in config["photos"].iterdir() if path.is_dir()):
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


class Handler(SimpleHTTPRequestHandler):
    server_version = "PhyloPhoto/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CLIENT_ROOT), **kwargs)

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
