CREATE TABLE IF NOT EXISTS imports (
    id BIGSERIAL PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by TEXT,
    bundle_id TEXT,
    app_version TEXT,
    app_build TEXT,
    os_version TEXT,
    device_model TEXT,
    exported_at TIMESTAMPTZ,
    flush_complete BOOLEAN,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    entry_count INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE imports ADD COLUMN IF NOT EXISTS device_name TEXT;

CREATE TABLE IF NOT EXISTS entries (
    id BIGSERIAL PRIMARY KEY,
    import_id BIGINT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    dedupe_key TEXT NOT NULL UNIQUE,
    ts TIMESTAMPTZ NOT NULL,
    process TEXT NOT NULL,
    kind TEXT NOT NULL,
    event_type TEXT,
    session_id TEXT,
    level TEXT,
    category TEXT,
    message TEXT,
    data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_import_ts ON entries (import_id, ts);
CREATE INDEX IF NOT EXISTS entries_ts ON entries (ts);
CREATE INDEX IF NOT EXISTS entries_event_type ON entries (event_type);

CREATE TABLE IF NOT EXISTS issues (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS occurrences (
    issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    entry_id BIGINT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, entry_id)
);

CREATE TABLE IF NOT EXISTS symbols (
    debug_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    arch TEXT NOT NULL,
    symcache BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by TEXT
);

CREATE TABLE IF NOT EXISTS builds (
    id BIGSERIAL PRIMARY KEY,
    bundle_id TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL,
    app_build TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by TEXT,
    archived_at TIMESTAMPTZ,
    archive_name TEXT,
    UNIQUE NULLS NOT DISTINCT (bundle_id, app_version, app_build, archived_at)
);
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS build_id BIGINT REFERENCES builds(id) ON DELETE SET NULL;
