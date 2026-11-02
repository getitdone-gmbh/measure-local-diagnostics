import io
import json
import os
import tempfile
import zipfile

import pgserver
import pytest

_server = pgserver.get_server(tempfile.mkdtemp(), cleanup_mode="stop")
os.environ["DATABASE_URL"] = _server.get_uri()
os.environ["AUTH_DISABLED"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        db.execute("TRUNCATE imports, entries, issues, occurrences, symbols, builds RESTART IDENTITY CASCADE")
        yield test_client


def frame(index: int, binary: str, base: int, offset: int) -> dict:
    return {
        "frame_index": index,
        "binary_name": binary,
        "binary_address": f"{base:016x}",
        "symbol_address": f"{base + offset:016x}",
        "in_app": False,
        "offset": 8,
    }


def exception_event(event_id: str, session: str, ts: str, offset: int = 0x1000) -> dict:
    app_base, sys_base = 0x100000000, 0x190000000
    return {
        "id": event_id,
        "session_id": session,
        "timestamp": ts,
        "type": "exception",
        "attribute": {"device_model": "iPhone 17 Pro", "os_version": "26.7.2", "app_version": "2.8.1"},
        "exception": {
            "severity": "fatal",
            "exceptions": [{
                "type": "EXC_BAD_ACCESS",
                "message": "KERN_INVALID_ADDRESS",
                "frames": [frame(0, "libsystem_kernel.dylib", sys_base, 0x20), frame(1, "NotesCore", app_base, offset)],
            }],
            "threads": [{"name": "com.apple.main-thread", "frames": [frame(0, "NotesCore", app_base, offset + 4)]}],
            "binary_images": [
                {"name": "NotesCore", "uuid": "ca1c6797fb2d30e28bd2501b2f0a5129", "arch": "arm64", "system": False},
                {"name": "libsystem_kernel.dylib", "uuid": "fad6415fbf893b78afd63d0110b38432", "arch": "arm64", "system": True},
            ],
        },
    }


def make_export(lines: list[dict], build: str = "1", device: str = "iPhone18,1") -> bytes:
    manifest = {"app_version": "2.8.1", "app_build": build, "bundle_id": "com.example.notes",
                "device_model": device, "os_version": "26.7.2", "exported_at": "2026-10-27T07:12:54Z",
                "measure_flush_complete": True, "files": ["app-2026-10-27.jsonl"]}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("Notes-Diagnostics/manifest.json", json.dumps(manifest))
        archive.writestr("Notes-Diagnostics/app-2026-10-27.jsonl", "\n".join(json.dumps(line) for line in lines) + "\n")
    return buffer.getvalue()


def sample_lines() -> list[dict]:
    session = "5a8c09c1-0000-0000-0000-000000000000"
    return [
        {"process": "app", "kind": "event", "data": {"id": "e1", "session_id": session, "timestamp": "2026-10-27T07:12:33.163Z",
                                                      "type": "gesture_click", "gesture_click": {"target": "UIButton"}}},
        {"process": "app", "kind": "app_log", "timestamp": "2026-10-27T07:12:35.000Z", "level": "info",
         "category": "MainApp", "message": "Hardware-backed unlock started"},
        {"process": "app", "kind": "event", "data": {"id": "e2", "session_id": session, "timestamp": "2026-10-27T07:12:38.173Z",
                                                      "type": "http", "http": {"method": "get", "url": "https://example.com/favicon.ico", "status_code": 200}}},
        {"process": "app", "kind": "event", "data": exception_event("crash1", session, "2026-10-27T07:12:39.878Z")},
        {"process": "app", "kind": "span", "data": {"span_id": "s1", "name": "launch", "session_id": "other", "start_time": "2026-10-27T07:12:41.853Z", "duration": 24}},
        {"process": "app", "kind": "app_log", "timestamp": "2026-10-27T07:20:00.000Z", "level": "info",
         "category": "MainApp", "message": "much later, outside the crashed session"},
    ]
