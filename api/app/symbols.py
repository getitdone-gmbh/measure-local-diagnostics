import io
import os
import plistlib
import tempfile
import zipfile
from functools import lru_cache

# symbolic 10.2.1 is the last release with Swift demangling in the Python bindings
import symbolic
from symbolic import Archive, SymCache

from . import db


def normalize_uuid(value: str | None) -> str:
    return (value or "").lower().replace("-", "")[:32]


def _store(obj, uploaded_by: str) -> dict:
    buffer = io.BytesIO()
    obj.make_symcache().dump_into(buffer)
    debug_id = normalize_uuid(obj.debug_id)
    name = os.path.basename(obj.name or "") if hasattr(obj, "name") else ""
    db.execute(
        """INSERT INTO symbols (debug_id, name, arch, symcache, uploaded_by)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (debug_id) DO UPDATE SET symcache = EXCLUDED.symcache, uploaded_at = now(), uploaded_by = EXCLUDED.uploaded_by""",
        (debug_id, name, obj.arch, buffer.getvalue(), uploaded_by),
    )
    _symcache.cache_clear()
    return {"debug_id": debug_id, "arch": obj.arch, "size": len(buffer.getvalue())}


def bundle_metadata(payload: bytes) -> dict | None:
    # Every .dSYM carries the app's version, build and bundle id in its Info.plist
    if not zipfile.is_zipfile(io.BytesIO(payload)):
        return None
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        plists = [name for name in archive.namelist() if name.endswith(".dSYM/Contents/Info.plist")]
        # Prefer the app's own dSYM, its bundle id names the app
        plists.sort(key=lambda name: (".app.dSYM/" not in name, name))
        for name in plists:
            try:
                info = plistlib.loads(archive.read(name))
            except Exception:
                continue
            version, build = info.get("CFBundleShortVersionString"), info.get("CFBundleVersion")
            if version and build:
                bundle = str(info.get("CFBundleIdentifier", "")).removeprefix("com.apple.xcode.dsym.")
                return {"app_version": str(version), "app_build": str(build), "bundle_id": bundle}
    return None


def import_symbols(filename: str, payload: bytes, uploaded_by: str) -> list[dict]:
    stored: list[dict] = []
    with tempfile.TemporaryDirectory() as workdir:
        candidates: list[tuple[str, str]] = []
        if zipfile.is_zipfile(io.BytesIO(payload)):
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for member in archive.infolist():
                    # Only DWARF payloads inside *.dSYM bundles carry debug information
                    if member.is_dir() or "/Contents/Resources/DWARF/" not in member.filename:
                        continue
                    target = os.path.join(workdir, str(len(candidates)))
                    with open(target, "wb") as handle:
                        handle.write(archive.read(member))
                    candidates.append((target, os.path.basename(member.filename)))
        else:
            target = os.path.join(workdir, "single")
            with open(target, "wb") as handle:
                handle.write(payload)
            candidates.append((target, filename))
        for path, name in candidates:
            try:
                archive = Archive.open(path)
            except Exception:
                continue
            for obj in archive.iter_objects():
                result = _store(obj, uploaded_by)
                db.execute("UPDATE symbols SET name = %s WHERE debug_id = %s", (name, result["debug_id"]))
                stored.append({**result, "name": name})
    return stored


@lru_cache(maxsize=32)
def _symcache(debug_id: str) -> SymCache | None:
    row = db.fetch_one("SELECT symcache FROM symbols WHERE debug_id = %s", (debug_id,))
    return SymCache.from_bytes(bytes(row["symcache"])) if row else None


def demangle(name: str | None) -> str | None:
    if not name:
        return name
    try:
        return symbolic.demangle_name(name, lang="swift") if name.startswith(("$s", "_$s", "$S", "_T")) else symbolic.demangle_name(name)
    except Exception:
        return name


def _address(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value), 16)
    except ValueError:
        return None


def symbolicate_frames(frames: list[dict], images: list[dict]) -> list[dict]:
    by_name = {image.get("name"): image for image in images or []}
    result = []
    for frame in frames or []:
        image = by_name.get(frame.get("binary_name"), {})
        # Measure stores the instruction address in symbol_address and the load address per frame
        instruction = _address(frame.get("instruction_address") or frame.get("symbol_address"))
        load = _address(frame.get("binary_address") or image.get("base_addr"))
        enriched = {
            "index": frame.get("frame_index"),
            "binary": frame.get("binary_name"),
            "in_app": bool(frame.get("in_app")) or bool(image and not image.get("system")),
            "address": hex(instruction) if instruction is not None else None,
            "offset": hex(instruction - load) if instruction is not None and load is not None else None,
            "function": None,
            "file": None,
            "line": None,
            "symbolicated": False,
            "library": None,
        }
        cache = _symcache(normalize_uuid(image.get("uuid"))) if image.get("uuid") else None
        if cache and instruction is not None and load is not None:
            locations = cache.lookup(instruction - load)
            if locations:
                location = locations[0]
                path = location.full_path or location.filename
                enriched.update(
                    function=demangle(location.symbol),
                    file=path,
                    line=location.line or None,
                    symbolicated=True,
                )
                # Swift packages (Measure, KSCrash) are linked into our binaries but are not our code
                library = library_of(path, location.symbol)
                if library:
                    enriched["in_app"] = False
                    enriched["library"] = library
        result.append(enriched)
    # Frames above the C++ terminate path are the crash reporter's own handler, even without symbols
    terminate_path = max((i for i, frame in enumerate(result) if frame["binary"] == "libc++abi.dylib"), default=0)
    for frame in result[:terminate_path]:
        if frame["in_app"] and not frame["symbolicated"]:
            frame["in_app"] = False
    return result


LIBRARY_MODULES = ("Measure", "KSCrashRecording", "KSCrashCore", "KSCrash", "SwiftCBOR")


def library_of(path: str | None, symbol: str | None) -> str | None:
    if path and "/SourcePackages/checkouts/" in path:
        return path.split("/SourcePackages/checkouts/")[1].split("/")[0]
    # Thunks have no source file, the module is part of the mangled Swift name ($s7Measure..., ...C7MeasureE...)
    for module in LIBRARY_MODULES:
        token = f"{len(module)}{module}"
        if symbol and (symbol.lstrip("_").startswith(f"$s{token}") or f"{token}E" in symbol):
            return module.lower()
    return None


def referenced_images(images: list[dict]) -> list[dict]:
    return [
        {"name": image.get("name"), "uuid": normalize_uuid(image.get("uuid")), "arch": image.get("arch")}
        for image in images or []
        if not image.get("system") and image.get("uuid")
    ]
