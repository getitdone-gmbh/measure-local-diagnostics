import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db
from .auth import current_user, symbols_uploader
from .importer import ImportFailed, crash_payload, import_zip, is_entry_point, regroup_issues
from .symbols import bundle_metadata, import_symbols, referenced_images, symbolicate_frames

RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "90"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "200")) * 1024 * 1024


def purge_expired() -> int:
    deleted = db.execute("DELETE FROM imports WHERE uploaded_at < now() - make_interval(days => %s)", (RETENTION_DAYS,))
    db.execute("DELETE FROM issues WHERE id NOT IN (SELECT DISTINCT issue_id FROM occurrences)")
    return deleted


async def _retention_loop() -> None:
    while True:
        await asyncio.to_thread(purge_expired)
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_pool()
    task = asyncio.create_task(_retention_loop())
    yield
    task.cancel()
    db.close_pool()


app = FastAPI(title="Measure Local Diagnostics", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.environ.get("WEB_ORIGIN", "http://localhost:5173").split(",") if origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _read_upload(file: UploadFile) -> bytes:
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    return payload


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/me")
def me(user: str = Depends(current_user)) -> dict:
    return {"user": user, "retention_days": RETENTION_DAYS}


@app.post("/api/imports")
async def create_import(file: UploadFile = File(...), user: str = Depends(current_user)) -> dict:
    payload = await _read_upload(file)
    try:
        return await asyncio.to_thread(import_zip, file.filename or "upload.zip", payload, user)
    except ImportFailed as error:
        raise HTTPException(422, str(error)) from error


@app.get("/api/imports")
def list_imports(_: str = Depends(current_user)) -> list[dict]:
    return db.fetch_all(
        """SELECT id, filename, uploaded_at, uploaded_by, app_version, app_build, os_version,
                  coalesce(device_name, device_model) AS device_model,
                  exported_at, flush_complete, entry_count,
                  (SELECT count(DISTINCT o.issue_id) FROM occurrences o JOIN entries e ON e.id = o.entry_id
                   WHERE e.import_id = imports.id) AS issue_count,
                  uploaded_at + make_interval(days => %s) AS expires_at
           FROM imports ORDER BY uploaded_at DESC""",
        (RETENTION_DAYS,),
    )


@app.delete("/api/imports/{import_id}")
def delete_import(import_id: int, _: str = Depends(current_user)) -> dict:
    deleted = db.execute("DELETE FROM imports WHERE id = %s", (import_id,))
    db.execute("DELETE FROM issues WHERE id NOT IN (SELECT DISTINCT issue_id FROM occurrences)")
    if not deleted:
        raise HTTPException(404, "Import not found")
    return {"deleted": import_id}


@app.get("/api/issues")
def list_issues(import_id: int | None = None, _: str = Depends(current_user)) -> list[dict]:
    # With import_id, only issues that occur in that export; counts still cover all imports
    where = "" if import_id is None else "WHERE s.id IN (SELECT o2.issue_id FROM occurrences o2 JOIN entries e2 ON e2.id = o2.entry_id WHERE e2.import_id = %s)"
    return db.fetch_all(
        """SELECT s.id, s.kind, s.title, s.status, s.note,
                  count(o.entry_id) AS occurrences,
                  min(e.ts) AS first_seen, max(e.ts) AS last_seen,
                  array_agg(DISTINCT e.process) AS processes,
                  array_agg(DISTINCT i.app_version || ' (' || coalesce(i.app_build, '?') || ')') AS versions,
                  array_agg(DISTINCT coalesce(i.device_name, i.device_model)) AS devices
           FROM issues s
           JOIN occurrences o ON o.issue_id = s.id
           JOIN entries e ON e.id = o.entry_id
           JOIN imports i ON i.id = e.import_id
           """ + where + """
           GROUP BY s.id ORDER BY max(e.ts) DESC""",
        () if import_id is None else (import_id,),
    )


class IssueUpdate(BaseModel):
    status: str | None = None
    note: str | None = None


@app.patch("/api/issues/{issue_id}")
def update_issue(issue_id: int, update: IssueUpdate, _: str = Depends(current_user)) -> dict:
    if update.status is not None and update.status not in {"open", "investigating", "resolved", "ignored"}:
        raise HTTPException(422, "Unknown status")
    row = db.fetch_one(
        """UPDATE issues SET status = coalesce(%s, status), note = coalesce(%s, note)
           WHERE id = %s RETURNING id, status, note""",
        (update.status, update.note, issue_id),
    )
    if not row:
        raise HTTPException(404, "Issue not found")
    return row


@app.get("/api/issues/{issue_id}")
def get_issue(issue_id: int, _: str = Depends(current_user)) -> dict:
    issue = db.fetch_one("SELECT id, kind, title, status, note FROM issues WHERE id = %s", (issue_id,))
    if not issue:
        raise HTTPException(404, "Issue not found")
    issue["occurrences"] = db.fetch_all(
        """SELECT e.id, e.ts, e.process, e.session_id, i.app_version, i.app_build, i.os_version,
                  coalesce(i.device_name, i.device_model) AS device_model, i.id AS import_id, i.filename
           FROM occurrences o JOIN entries e ON e.id = o.entry_id JOIN imports i ON i.id = e.import_id
           WHERE o.issue_id = %s ORDER BY e.ts DESC""",
        (issue_id,),
    )
    return issue


def _crash_window(entry: dict) -> dict:
    # The crash event is written on the next launch: the crash happened after the last activity and before the relaunch
    if entry["data"].get("type") != "exception":
        return {"after": entry["ts"], "before": entry["ts"], "exact": True}
    last = db.fetch_one(
        "SELECT max(ts) AS ts FROM entries WHERE session_id = %s AND id <> %s",
        (entry["session_id"], entry["id"]),
    ) if entry["session_id"] else None
    relaunch = (entry["data"].get("attribute") or {}).get("session_start_time")
    before = datetime.fromisoformat(relaunch.replace("Z", "+00:00")) if relaunch else entry["ts"]
    return {"after": (last or {}).get("ts") or before, "before": min(before, entry["ts"]), "exact": False}


def _timeline(entry: dict, window: dict) -> list[dict]:
    start_row = db.fetch_one(
        "SELECT min(ts) AS ts FROM entries WHERE session_id = %s AND id <> %s",
        (entry["session_id"], entry["id"]),
    ) if entry["session_id"] else None
    start = (start_row or {}).get("ts") or window["after"] - timedelta(minutes=5)
    # All processes of the device in that window: the Autofill extension runs in its own session
    return db.fetch_all(
        """SELECT e.id, e.ts, e.process, e.kind, e.event_type, e.level, e.category, e.message, e.session_id
           FROM entries e
           WHERE e.import_id IN (SELECT id FROM imports WHERE device_model IS NOT DISTINCT FROM %s)
             AND (e.id = %s OR e.session_id = %s OR e.ts BETWEEN %s AND %s)
           ORDER BY e.ts""",
        (entry["device_model"], entry["id"], entry["session_id"], start - timedelta(seconds=1), window["after"]),
    )


@app.get("/api/occurrences/{entry_id}")
def get_occurrence(entry_id: int, _: str = Depends(current_user)) -> dict:
    entry = db.fetch_one(
        """SELECT e.id, e.ts, e.process, e.session_id, e.data, i.device_model, i.app_version, i.app_build, i.os_version,
                  i.filename, i.id AS import_id
           FROM entries e JOIN imports i ON i.id = e.import_id WHERE e.id = %s AND e.event_type IN ('exception', 'app_hang')""",
        (entry_id,),
    )
    if not entry:
        raise HTTPException(404, "Occurrence not found")
    payload = crash_payload(entry["data"])
    images = payload["images"]

    def frames(raw: list[dict]) -> list[dict]:
        return [{**frame, "entry_point": is_entry_point(frame)} for frame in symbolicate_frames(raw, images)]

    stacks = [
        {"name": detail.get("type") or detail.get("thread_name") or "Crashed thread", "crashed": index == 0,
         "reason": detail.get("message"), "signal": detail.get("signal"), "frames": frames(detail.get("frames") or [])}
        for index, detail in enumerate(payload["details"])
    ] + [
        {"name": thread.get("name") or f'Thread {thread.get("sequence", "")}', "crashed": False, "reason": None,
         "signal": None, "frames": frames(thread.get("frames") or [])}
        for thread in payload["threads"]
    ]
    uploaded = {row["debug_id"] for row in db.fetch_all("SELECT debug_id FROM symbols")}
    window = _crash_window(entry)
    return {
        "id": entry["id"],
        "kind": payload["kind"],
        "ts": entry["ts"],
        "window": window,
        "process": entry["process"],
        "session_id": entry["session_id"],
        "duration_ms": payload["duration"],
        "foreground": payload["foreground"],
        "context": {
            **(entry["data"].get("attribute") or {}),
            "import": entry["filename"],
            "import_id": entry["import_id"],
        },
        "stacks": stacks,
        "images": [{**image, "symbols": image["uuid"] in uploaded} for image in referenced_images(images)],
        "timeline": _timeline(entry, window),
    }


@app.get("/api/entries")
def list_entries(
    import_id: int | None = None,
    process: str | None = None,
    kind: str | None = None,
    level: str | None = None,
    q: str | None = None,
    since: datetime | None = Query(None, alias="from"),
    until: datetime | None = Query(None, alias="to"),
    limit: int = Query(500, le=5000),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    _: str = Depends(current_user),
) -> dict:
    clauses, params = [], []
    for column, value in (("import_id", import_id), ("process", process), ("kind", kind), ("level", level)):
        if value is not None:
            clauses.append(f"{column} = %s")
            params.append(value)
    if since:
        clauses.append("ts >= %s")
        params.append(since)
    if until:
        clauses.append("ts <= %s")
        params.append(until)
    if q:
        clauses.append("(message ILIKE %s OR category ILIKE %s OR event_type ILIKE %s)")
        params += [f"%{q}%"] * 3
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    total = db.fetch_one(f"SELECT count(*) AS total FROM entries {where}", tuple(params))["total"]
    items = db.fetch_all(
        f"""SELECT e.id, e.import_id, e.ts, e.process, e.kind, e.event_type, e.session_id, e.level, e.category, e.message,
                   (SELECT issue_id FROM occurrences o WHERE o.entry_id = e.id LIMIT 1) AS issue_id
            FROM entries e {where} ORDER BY ts {'ASC' if order == 'asc' else 'DESC'} LIMIT %s""",
        (*params, limit),
    )
    return {"total": total, "items": items}


@app.get("/api/entries/{entry_id}")
def get_entry(entry_id: int, _: str = Depends(current_user)) -> dict:
    entry = db.fetch_one("SELECT * FROM entries WHERE id = %s", (entry_id,))
    if not entry:
        raise HTTPException(404, "Entry not found")
    return entry


def _register_build(bundle_id: str, version: str, build: str, archived_at: datetime | None, archive_name: str | None, user: str) -> int:
    # Archives can share version and build number (Xcode may renumber on upload), the archive time tells them apart
    return db.fetch_one(
        """INSERT INTO builds (bundle_id, app_version, app_build, archived_at, archive_name, uploaded_by) VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (bundle_id, app_version, app_build, archived_at)
           DO UPDATE SET uploaded_at = now(), uploaded_by = EXCLUDED.uploaded_by, archive_name = EXCLUDED.archive_name
           RETURNING id""",
        (bundle_id, version, build, archived_at, archive_name, user),
    )["id"]


@app.post("/api/symbols")
async def upload_symbols(
    file: UploadFile = File(...),
    app_version: str | None = Form(None),
    app_build: str | None = Form(None),
    bundle_id: str | None = Form(None),
    archived_at: datetime | None = Form(None),
    archive_name: str | None = Form(None),
    user: str = Depends(symbols_uploader),
) -> dict:
    payload = await _read_upload(file)
    stored = await asyncio.to_thread(import_symbols, file.filename or "dsym", payload, user)
    if not stored:
        raise HTTPException(422, "No debug information found. Upload a ZIP of .dSYM bundles.")
    build_id = None
    debug_ids = [item["debug_id"] for item in stored]
    if not (app_version and app_build):
        # Symbols that already belong to a build keep it, a manual re-upload must not create a duplicate row
        known = db.fetch_one("SELECT build_id FROM symbols WHERE debug_id = ANY(%s) AND build_id IS NOT NULL LIMIT 1", (debug_ids,))
        if known:
            db.execute("UPDATE symbols SET build_id = %s WHERE debug_id = ANY(%s) AND build_id IS NULL", (known["build_id"], debug_ids))
            await asyncio.to_thread(regroup_issues)
            return {"stored": stored, "build_id": known["build_id"]}
        # A manual upload carries no form fields, the dSYM bundles still name their build
        meta = bundle_metadata(payload) or {}
        app_version, app_build, bundle_id = meta.get("app_version"), meta.get("app_build"), bundle_id or meta.get("bundle_id")
    if app_version and app_build:
        build_id = _register_build(bundle_id or "", app_version, app_build, archived_at, archive_name, user)
        db.execute("UPDATE symbols SET build_id = %s WHERE debug_id = ANY(%s)", (build_id, debug_ids))
    await asyncio.to_thread(regroup_issues)
    return {"stored": stored, "build_id": build_id}


@app.get("/api/builds")
def list_builds(_: str = Depends(current_user)) -> list[dict]:
    builds = db.fetch_all(
        """SELECT b.id, b.bundle_id, b.app_version, b.app_build, b.archived_at, b.archive_name, b.uploaded_at, b.uploaded_by,
                  coalesce(array_agg(s.debug_id) FILTER (WHERE s.debug_id IS NOT NULL), '{}') AS debug_ids,
                  coalesce(array_agg(s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS binaries
           FROM builds b LEFT JOIN symbols s ON s.build_id = b.id
           GROUP BY b.id ORDER BY coalesce(b.archived_at, b.uploaded_at) DESC"""
    )
    # A crash belongs to a build when one of its binaries carries a UUID of that build
    usage: dict[str, set[int]] = {}
    reported: dict[str, set[str]] = {}
    for row in db.fetch_all(
        """SELECT e.data, o.issue_id, i.app_version, i.app_build FROM entries e
           JOIN occurrences o ON o.entry_id = e.id JOIN imports i ON i.id = e.import_id
           WHERE e.event_type IN ('exception', 'app_hang')"""
    ):
        for image in referenced_images(crash_payload(row["data"])["images"]):
            usage.setdefault(image["uuid"], set()).add(row["issue_id"])
            # The build number the tester sees can differ from the archive if Xcode renumbered on upload
            reported.setdefault(image["uuid"], set()).add(f'{row["app_version"]} ({row["app_build"]})')
    titles = {row["id"]: row for row in db.fetch_all("SELECT id, kind, title FROM issues")}
    for build in builds:
        ids = sorted(set().union(*(usage.get(debug_id, set()) for debug_id in build["debug_ids"]))) if build["debug_ids"] else []
        build["issues"] = [titles[issue_id] for issue_id in ids if issue_id in titles]
        build["reported_versions"] = sorted(set().union(*(reported.get(debug_id, set()) for debug_id in build["debug_ids"]))) if build["debug_ids"] else []
        build["variant"] = "dev" if build["bundle_id"].endswith(".dev") else ("prod" if build["bundle_id"] else None)
        build["issue_ids"] = ids
    return builds


@app.get("/api/symbols")
def list_symbols(_: str = Depends(current_user)) -> dict:
    uploaded = db.fetch_all(
        "SELECT debug_id, name, arch, length(symcache) AS size, uploaded_at, uploaded_by FROM symbols ORDER BY uploaded_at DESC"
    )
    known = {row["debug_id"] for row in uploaded}
    missing: dict[str, dict] = {}
    referenced: dict[str, set] = {}
    for row in db.fetch_all(
        """SELECT e.data, i.app_version, i.app_build, o.issue_id FROM entries e
           JOIN imports i ON i.id = e.import_id LEFT JOIN occurrences o ON o.entry_id = e.id
           WHERE e.event_type IN ('exception', 'app_hang')"""
    ):
        for image in referenced_images(crash_payload(row["data"])["images"]):
            referenced.setdefault(image["uuid"], set()).add(f'{row["app_version"]} ({row["app_build"]})')
            if image["uuid"] not in known:
                item = missing.setdefault(image["uuid"], {**image, "app_version": row["app_version"], "app_build": row["app_build"], "issue_ids": []})
                if row["issue_id"] and row["issue_id"] not in item["issue_ids"]:
                    item["issue_ids"].append(row["issue_id"])
    for row in uploaded:
        row["versions"] = sorted(referenced.get(row["debug_id"], set()))
    titles = {row["id"]: row for row in db.fetch_all("SELECT id, kind, title FROM issues")}
    for item in missing.values():
        item["issues"] = [titles[issue_id] for issue_id in item["issue_ids"] if issue_id in titles]
    return {"uploaded": uploaded, "missing": list(missing.values())}
