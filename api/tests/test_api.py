import glob
import io
import os
import zipfile

import pytest

from app import db
from app.main import purge_expired

from .conftest import exception_event, make_export, sample_lines


def upload(client, payload: bytes, name: str = "export.zip"):
    return client.post("/api/imports", files={"file": (name, payload, "application/zip")})


def test_import_creates_entries_and_one_issue(client):
    result = upload(client, make_export(sample_lines())).json()
    assert result["inserted"] == 6
    assert result["issues"] == 1
    issues = client.get("/api/issues").json()
    assert len(issues) == 1
    assert issues[0]["kind"] == "crash"
    assert issues[0]["title"].startswith("EXC_BAD_ACCESS in NotesCore+0x1000")
    assert issues[0]["occurrences"] == 1


def test_same_zip_twice_is_a_duplicate(client):
    payload = make_export(sample_lines())
    upload(client, payload)
    second = upload(client, payload).json()
    assert second["duplicate"] is True
    assert len(client.get("/api/imports").json()) == 1


def test_overlapping_exports_do_not_duplicate_entries(client):
    upload(client, make_export(sample_lines()))
    extended = sample_lines() + [{"process": "autofill", "kind": "app_log", "timestamp": "2026-10-27T08:00:00Z",
                                  "level": "error", "category": "CredentialProviderVC", "message": "new line"}]
    result = upload(client, make_export(extended), "later.zip").json()
    assert result["inserted"] == 1
    assert result["skipped"] == 6


def test_same_crash_in_two_sessions_groups_into_one_issue(client):
    lines = sample_lines() + [{"process": "app", "kind": "event",
                               "data": exception_event("crash2", "other-session", "2026-10-27T09:00:00Z")}]
    upload(client, make_export(lines))
    issues = client.get("/api/issues").json()
    assert len(issues) == 1
    assert issues[0]["occurrences"] == 2


def test_different_crash_location_is_a_separate_issue(client):
    lines = sample_lines() + [{"process": "app", "kind": "event",
                               "data": exception_event("crash3", "other-session", "2026-10-27T09:00:00Z", offset=0x2000)}]
    upload(client, make_export(lines))
    assert len(client.get("/api/issues").json()) == 2


def test_occurrence_has_stacks_context_and_session_timeline(client):
    upload(client, make_export(sample_lines()))
    issue = client.get("/api/issues").json()[0]
    occurrence_id = client.get(f"/api/issues/{issue['id']}").json()["occurrences"][0]["id"]
    detail = client.get(f"/api/occurrences/{occurrence_id}").json()

    assert detail["stacks"][0]["crashed"] is True
    assert detail["stacks"][0]["frames"][1]["in_app"] is True
    assert detail["stacks"][0]["frames"][1]["offset"] == "0x1000"
    assert detail["context"]["device_model"] == "iPhone 17 Pro"
    assert detail["images"] == [{"name": "NotesCore", "uuid": "ca1c6797fb2d30e28bd2501b2f0a5129", "arch": "arm64", "symbols": False}]
    messages = [entry["message"] for entry in detail["timeline"]]
    assert "Hardware-backed unlock started" in messages
    assert "much later, outside the crashed session" not in messages
    assert any(entry["event_type"] == "http" for entry in detail["timeline"])


def test_entries_filter_by_kind_and_text(client):
    upload(client, make_export(sample_lines()))
    logs = client.get("/api/entries", params={"kind": "app_log"}).json()["items"]
    assert len(logs) == 2
    found = client.get("/api/entries", params={"q": "unlock"}).json()["items"]
    assert [entry["message"] for entry in found] == ["Hardware-backed unlock started"]


def test_issue_status_and_note(client):
    upload(client, make_export(sample_lines()))
    issue_id = client.get("/api/issues").json()[0]["id"]
    assert client.patch(f"/api/issues/{issue_id}", json={"status": "investigating", "note": "Ticket PG-213"}).status_code == 200
    assert client.patch(f"/api/issues/{issue_id}", json={"status": "whatever"}).status_code == 422
    issue = client.get(f"/api/issues/{issue_id}").json()
    assert (issue["status"], issue["note"]) == ("investigating", "Ticket PG-213")


def test_delete_import_removes_orphaned_issues(client):
    import_id = upload(client, make_export(sample_lines())).json()["import_id"]
    assert client.delete(f"/api/imports/{import_id}").status_code == 200
    assert client.get("/api/issues").json() == []
    assert client.get("/api/entries").json()["items"] == []


def test_retention_purges_old_imports(client):
    upload(client, make_export(sample_lines()))
    db.execute("UPDATE imports SET uploaded_at = now() - interval '91 days'")
    assert purge_expired() == 1
    assert client.get("/api/issues").json() == []


def test_rejects_zip_without_manifest(client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "hello")
    response = upload(client, buffer.getvalue())
    assert response.status_code == 422


def test_missing_symbols_are_listed(client):
    upload(client, make_export(sample_lines()))
    missing = client.get("/api/symbols").json()["missing"]
    assert [image["uuid"] for image in missing] == ["ca1c6797fb2d30e28bd2501b2f0a5129"]


def test_requires_token_when_auth_is_enabled(client, monkeypatch):
    monkeypatch.delenv("AUTH_DISABLED")
    assert client.get("/api/issues").status_code == 401


@pytest.mark.skipif(not os.environ.get("LOCAL_EXPORT") or not os.environ.get("LOCAL_DSYMS"),
                    reason="needs a real export (LOCAL_EXPORT) and a folder of .dSYM bundles (LOCAL_DSYMS)")
def test_real_export_symbolicates_with_dsyms(client):
    upload(client, open(os.environ["LOCAL_EXPORT"], "rb").read(), "real.zip")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in glob.glob(os.environ["LOCAL_DSYMS"] + "/**/*", recursive=True):
            if os.path.isfile(path):
                archive.write(path, os.path.relpath(path, os.environ["LOCAL_DSYMS"]))
    response = client.post("/api/symbols", files={"file": ("dsyms.zip", buffer.getvalue(), "application/zip")},
                           data={"app_version": "2.8.1", "app_build": "1", "bundle_id": "com.example.notes",
                                 "archived_at": "2026-10-27T07:00:00Z", "archive_name": "Notes 27.10.26, 08.00"}).json()
    assert response["stored"]
    builds = client.get("/api/builds").json()
    assert [(b["app_version"], b["app_build"]) for b in builds] == [("2.8.1", "1")]
    assert builds[0]["issue_ids"], "the imported crash must be linked to the uploaded build"
    issue = client.get("/api/issues").json()[0]
    occurrence_id = client.get(f"/api/issues/{issue['id']}").json()["occurrences"][0]["id"]
    frames = [frame for stack in client.get(f"/api/occurrences/{occurrence_id}").json()["stacks"] for frame in stack["frames"]]
    functions = [frame["function"] for frame in frames if frame["symbolicated"]]
    assert "UIApplication.swizzled_sendEvent(UIEvent)" in functions
    print("\n".join(f'{frame["binary"]} {frame["function"]} {frame["file"]}:{frame["line"]}' for frame in frames if frame["symbolicated"])[:1500])


def test_entry_points_do_not_count_as_own_code():
    from app.importer import is_entry_point
    assert is_entry_point({"function": "static NotesApp.$main()"})
    assert is_entry_point({"function": "__debug_main_executable_dylib_entry_point"})
    assert not is_entry_point({"function": "UIApplication.swizzled_sendEvent(UIEvent)"})


def test_crash_without_own_frames_is_titled_by_system_binary(client):
    event = exception_event("crash-system", "s2", "2026-10-27T09:00:00Z")
    event["exception"]["exceptions"][0]["frames"] = event["exception"]["exceptions"][0]["frames"][:1]
    upload(client, make_export([{"process": "app", "kind": "event", "data": event}]))
    assert client.get("/api/issues").json()[0]["title"] == "EXC_BAD_ACCESS in libsystem_kernel.dylib"


def test_crash_window_spans_last_activity_to_relaunch(client):
    lines = sample_lines()
    lines[3]["data"]["attribute"]["session_start_time"] = "2026-10-27T07:12:39.829Z"
    upload(client, make_export(lines))
    issue = client.get("/api/issues").json()[0]
    occurrence_id = client.get(f"/api/issues/{issue['id']}").json()["occurrences"][0]["id"]
    window = client.get(f"/api/occurrences/{occurrence_id}").json()["window"]
    assert window["exact"] is False
    assert window["after"].startswith("2026-10-27T07:12:38.173")
    assert window["before"].startswith("2026-10-27T07:12:39.829")


def test_timeline_includes_autofill_entries_of_other_sessions(client):
    lines = sample_lines() + [{"process": "autofill", "kind": "event", "data": {
        "id": "af1", "session_id": "autofill-session", "timestamp": "2026-10-27T07:12:36.000Z",
        "type": "lifecycle_view_controller", "lifecycle_view_controller": {"type": "viewDidLoad", "class_name": "CredentialProviderViewController"}}}]
    upload(client, make_export(lines))
    issue = client.get("/api/issues").json()[0]
    occurrence_id = client.get(f"/api/issues/{issue['id']}").json()["occurrences"][0]["id"]
    timeline = client.get(f"/api/occurrences/{occurrence_id}").json()["timeline"]
    assert any(entry["process"] == "autofill" for entry in timeline)


def test_entries_report_total_and_filter_by_time(client):
    upload(client, make_export(sample_lines()))
    result = client.get("/api/entries", params={"from": "2026-10-27T07:12:34Z", "to": "2026-10-27T07:12:39Z", "limit": 1}).json()
    assert result["total"] == 2
    assert len(result["items"]) == 1


def test_upload_key_only_opens_the_symbols_upload(client, monkeypatch):
    monkeypatch.delenv("AUTH_DISABLED")
    monkeypatch.setenv("SYMBOLS_UPLOAD_TOKEN", "build-key")
    files = {"file": ("dsyms.zip", b"not a dsym", "application/zip")}
    assert client.post("/api/symbols", files=files, headers={"Authorization": "Bearer wrong"}).status_code == 401
    # Passes authentication, then fails on the content
    assert client.post("/api/symbols", files=files, headers={"Authorization": "Bearer build-key"}).status_code == 422
    assert client.get("/api/builds", headers={"Authorization": "Bearer build-key"}).status_code == 401
    assert client.get("/api/issues", headers={"Authorization": "Bearer build-key"}).status_code == 401


def test_builds_list_is_empty_without_uploads(client):
    assert client.get("/api/builds").json() == []


def test_manual_dsym_upload_registers_its_build(client):
    from app.symbols import bundle_metadata
    import plistlib
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("dSYMs/Notes.app.dSYM/Contents/Info.plist", plistlib.dumps(
            {"CFBundleIdentifier": "com.apple.xcode.dsym.com.example.notes", "CFBundleShortVersionString": "2.9.0", "CFBundleVersion": "12"}))
    assert bundle_metadata(buffer.getvalue()) == {"app_version": "2.9.0", "app_build": "12", "bundle_id": "com.example.notes"}


@pytest.mark.skipif(not os.environ.get("LOCAL_DSYMS"), reason="needs a folder of .dSYM bundles (LOCAL_DSYMS)")
def test_manual_reupload_keeps_the_archived_build(client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in glob.glob(os.environ["LOCAL_DSYMS"] + "/**/*", recursive=True):
            if os.path.isfile(path):
                archive.write(path, os.path.relpath(path, os.environ["LOCAL_DSYMS"]))
    files = {"file": ("dsyms.zip", buffer.getvalue(), "application/zip")}
    client.post("/api/symbols", files=files, data={"app_version": "2.8.1", "app_build": "1", "archived_at": "2026-10-27T07:00:00Z"})
    client.post("/api/symbols", files=files)
    assert len(client.get("/api/builds").json()) == 1


def test_crash_reporter_frames_above_terminate_path_are_not_app_code():
    from app.symbols import symbolicate_frames
    def frame(index, binary, base, offset, in_app):
        return {"frame_index": index, "binary_name": binary, "binary_address": f"{base:016x}", "symbol_address": f"{base + offset:016x}", "in_app": in_app}
    frames = symbolicate_frames([
        frame(0, "CoreFoundation", 0x190000000, 0x10, False),
        frame(1, "NotesCore", 0x100000000, 0x31b4cc, True),
        frame(2, "libc++abi.dylib", 0x191000000, 0x20, False),
        frame(3, "Notes.debug.dylib", 0x102000000, 0x1116a8, True),
    ], [])
    assert [f["in_app"] for f in frames] == [False, False, False, True]
    swift_trap = symbolicate_frames([frame(0, "libswiftCore.dylib", 0x190000000, 0x10, False), frame(1, "Notes.debug.dylib", 0x102000000, 0x1116a8, True)], [])
    assert [f["in_app"] for f in swift_trap] == [False, True]


def test_issues_can_be_filtered_by_import(client):
    first = upload(client, make_export(sample_lines(), build="1"), "first.zip").json()
    imports = client.get("/api/imports").json()
    assert imports[0]["issue_count"] >= 1
    assert len(client.get(f"/api/issues?import_id={first['import_id']}").json()) >= 1
    assert client.get("/api/issues?import_id=999999").json() == []
