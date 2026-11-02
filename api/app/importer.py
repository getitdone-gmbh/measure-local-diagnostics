import hashlib
import io
import json
import zipfile
from datetime import datetime

from psycopg.types.json import Jsonb

from . import db
from .symbols import symbolicate_frames

ISSUE_TYPES = {"exception": "crash", "app_hang": "hang"}


class ImportFailed(ValueError):
    pass


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _summary(event: dict) -> str:
    kind = event.get("type", "")
    data = event.get(kind) or {}
    if kind == "exception":
        first = (data.get("exceptions") or [{}])[0]
        return f'{first.get("type", "Exception")} {first.get("message") or ""}'.strip()
    if kind == "app_hang":
        return f'Hang {data.get("duration", "?")} ms'
    if kind == "http":
        return f'{(data.get("method") or "").upper()} {data.get("url", "")} → {data.get("status_code", "–")}'
    if kind.startswith("gesture_"):
        position = f' at {round(data["x"])},{round(data["y"])}' if data.get("x") is not None else ""
        return f'{kind.removeprefix("gesture_")} on {data.get("target", "?")}{position}'
    if kind == "screen_view":
        return data.get("name", "")
    if kind.startswith("lifecycle_"):
        return " ".join(str(data.get(key)) for key in ("type", "class_name") if data.get(key))
    if kind == "cpu_usage":
        usage = data.get("percentage_usage")
        return f'CPU {round(usage, 1) if isinstance(usage, (int, float)) else "?"} % ({data.get("num_cores", "?")} cores)'
    if kind == "memory_usage_absolute":
        # Measure reports kilobytes
        used, available = data.get("used_memory"), data.get("available_memory")
        return f'Memory {round(used / 1024)} MB used, {round(available / 1024)} MB available' if used and available else "Memory"
    if kind in ("cold_launch", "warm_launch", "hot_launch"):
        start, drawn = data.get("process_start_uptime") or data.get("app_visible_uptime"), data.get("on_next_draw_uptime")
        return f'{kind.replace("_", " ")} {drawn - start} ms' if start and drawn else kind.replace("_", " ")
    if kind == "log":
        return data.get("body", "")
    if kind == "bug_report":
        return data.get("description", "")
    return kind


def _entry_from_line(entry: dict) -> dict:
    kind = entry.get("kind")
    process = entry.get("process", "app")
    if kind == "app_log":
        raw = json.dumps(entry, sort_keys=True)
        return {
            "dedupe_key": "log:" + hashlib.sha1(raw.encode()).hexdigest(),
            "ts": _parse_ts(entry.get("timestamp")),
            "process": process,
            "kind": "app_log",
            "event_type": None,
            "session_id": None,
            "level": entry.get("level"),
            "category": entry.get("category"),
            "message": entry.get("message"),
            "data": entry,
        }
    data = entry.get("data") or {}
    if kind == "span":
        return {
            "dedupe_key": "span:" + str(data.get("span_id") or hashlib.sha1(json.dumps(data, sort_keys=True).encode()).hexdigest()),
            "ts": _parse_ts(data.get("start_time")),
            "process": process,
            "kind": "span",
            "event_type": "span",
            "session_id": data.get("session_id"),
            "level": None,
            "category": data.get("name"),
            "message": f'{data.get("name", "span")} {data.get("duration", "")} ms'.strip(),
            "data": data,
        }
    return {
        "dedupe_key": "event:" + str(data.get("id") or hashlib.sha1(json.dumps(data, sort_keys=True).encode()).hexdigest()),
        "ts": _parse_ts(data.get("timestamp")),
        "process": process,
        "kind": "event",
        "event_type": data.get("type"),
        "session_id": data.get("session_id"),
        "level": "error" if data.get("type") in ISSUE_TYPES else None,
        "category": data.get("type"),
        "message": _summary(data),
        "data": data,
    }


def crash_payload(event: dict) -> dict:
    kind = event.get("type")
    payload = event.get(kind) or {}
    return {
        "kind": ISSUE_TYPES.get(kind, kind),
        "details": payload.get("exceptions") or [],
        "threads": payload.get("threads") or [],
        "images": payload.get("binary_images") or [],
        "duration": payload.get("duration"),
        "foreground": payload.get("foreground"),
    }


ENTRY_POINTS = ("$main()", "__debug_main_executable_dylib_entry_point")


def is_entry_point(frame: dict) -> bool:
    # The app's main function is in every main-thread stack, it says nothing about the failure
    function = frame.get("function") or ""
    return function.endswith(ENTRY_POINTS) or function in {"main", "start"}


def _frame_key(frame: dict) -> str:
    return frame["function"] or f'{frame["binary"]}+{frame["offset"]}'


def fingerprint(event: dict, app_build: str | None) -> tuple[str, str, str]:
    payload = crash_payload(event)
    first = payload["details"][0] if payload["details"] else {}
    frames = symbolicate_frames(first.get("frames") or [], payload["images"])
    own = [frame for frame in frames if frame["in_app"] and not is_entry_point(frame)][:3]
    label = first.get("type") or ("Hang" if payload["kind"] == "hang" else "Crash")
    if own:
        keys = [_frame_key(frame) for frame in own]
        # Symbolicated function names are stable across builds, raw offsets only within one build
        version = [] if all(frame["symbolicated"] for frame in own) else [app_build or ""]
        title = f"{label} in {_frame_key(own[0])}"
    else:
        # No own code on the stack: group by the topmost system frames, offsets are stable per OS build
        top = frames[:3]
        keys = [_frame_key(frame) for frame in top]
        version = [first.get("os_build_number") or ""]
        crashed_in = frames[0]["binary"] if frames else "unknown frame"
        caller = next((frame["binary"] for frame in frames[1:10] if frame["binary"] != crashed_in), None)
        title = f"{label} in {crashed_in}" + (f" (from {caller})" if caller else "")
    signature = "|".join([payload["kind"], first.get("type") or "", *keys, *version])
    return hashlib.sha256(signature.encode()).hexdigest(), payload["kind"], title


def _assign_issue(conn, entry_id: int, event: dict, app_build: str | None) -> None:
    digest, kind, title = fingerprint(event, app_build)
    row = conn.execute(
        """INSERT INTO issues (fingerprint, kind, title) VALUES (%s, %s, %s)
           ON CONFLICT (fingerprint) DO UPDATE SET title = EXCLUDED.title
           RETURNING id""",
        (digest, kind, title),
    ).fetchone()
    conn.execute("INSERT INTO occurrences (issue_id, entry_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (row["id"], entry_id))


def import_zip(filename: str, payload: bytes, uploaded_by: str) -> dict:
    digest = hashlib.sha256(payload).hexdigest()
    existing = db.fetch_one("SELECT id FROM imports WHERE sha256 = %s", (digest,))
    if existing:
        return {"import_id": existing["id"], "duplicate": True, "inserted": 0, "skipped": 0, "issues": 0}
    if not zipfile.is_zipfile(io.BytesIO(payload)):
        raise ImportFailed("Not a ZIP file")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        manifest_name = next((name for name in names if name.endswith("manifest.json")), None)
        if not manifest_name:
            raise ImportFailed("manifest.json missing, not a diagnostics export")
        manifest = json.loads(archive.read(manifest_name))
        lines = [
            line
            for name in names
            if name.endswith(".jsonl")
            for line in archive.read(name).decode("utf-8").splitlines()
            if line.strip()
        ]

    inserted = skipped = issues = 0
    with db.connection() as conn, conn.transaction():
        import_id = conn.execute(
            """INSERT INTO imports (sha256, filename, uploaded_by, bundle_id, app_version, app_build, os_version,
                                    device_model, exported_at, flush_complete, manifest)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (
                digest,
                filename,
                uploaded_by,
                manifest.get("bundle_id"),
                manifest.get("app_version"),
                manifest.get("app_build"),
                manifest.get("os_version"),
                manifest.get("device_model"),
                _parse_ts(manifest.get("exported_at")),
                manifest.get("measure_flush_complete"),
                Jsonb(manifest),
            ),
        ).fetchone()["id"]
        for line in lines:
            try:
                entry = _entry_from_line(json.loads(line))
            except (json.JSONDecodeError, AttributeError):
                skipped += 1
                continue
            if entry["ts"] is None:
                skipped += 1
                continue
            row = conn.execute(
                """INSERT INTO entries (import_id, dedupe_key, ts, process, kind, event_type, session_id, level, category, message, data)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (dedupe_key) DO NOTHING RETURNING id""",
                (
                    import_id,
                    entry["dedupe_key"],
                    entry["ts"],
                    entry["process"],
                    entry["kind"],
                    entry["event_type"],
                    entry["session_id"],
                    entry["level"],
                    entry["category"],
                    entry["message"],
                    Jsonb(entry["data"]),
                ),
            ).fetchone()
            if not row:
                skipped += 1
                continue
            inserted += 1
            if entry["event_type"] in ISSUE_TYPES:
                _assign_issue(conn, row["id"], entry["data"], manifest.get("app_build"))
                issues += 1
        conn.execute(
            """UPDATE imports SET entry_count = %s,
                      device_name = (SELECT data->'attribute'->>'device_model' FROM entries
                                     WHERE import_id = %s AND data->'attribute'->>'device_model' IS NOT NULL LIMIT 1)
               WHERE id = %s""",
            (inserted, import_id, import_id),
        )
    return {"import_id": import_id, "duplicate": False, "inserted": inserted, "skipped": skipped, "issues": issues}


def regroup_issues() -> int:
    # Called after new symbols arrive: offsets become function names, so fingerprints may merge
    rows = db.fetch_all(
        """SELECT e.id, e.data, i.app_build FROM entries e JOIN imports i ON i.id = e.import_id
           WHERE e.event_type IN ('exception', 'app_hang')"""
    )
    with db.connection() as conn, conn.transaction():
        old = {r["entry_id"]: r for r in conn.execute(
            "SELECT o.entry_id, s.status, s.note FROM occurrences o JOIN issues s ON s.id = o.issue_id").fetchall()}
        conn.execute("DELETE FROM occurrences")
        for row in rows:
            _assign_issue(conn, row["id"], row["data"], row["app_build"])
            previous = old.get(row["id"])
            if previous and (previous["status"] != "open" or previous["note"]):
                conn.execute(
                    """UPDATE issues SET status = %s, note = CASE WHEN note = '' THEN %s ELSE note END
                       WHERE id = (SELECT issue_id FROM occurrences WHERE entry_id = %s LIMIT 1)""",
                    (previous["status"], previous["note"], row["id"]),
                )
        conn.execute("DELETE FROM issues WHERE id NOT IN (SELECT DISTINCT issue_id FROM occurrences)")
    return len(rows)
