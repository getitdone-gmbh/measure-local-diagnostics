export type IssueKind = 'crash' | 'hang';
export type IssueStatus = 'open' | 'investigating' | 'resolved' | 'ignored';

export interface IssueSummary {
  id: number;
  kind: IssueKind;
  title: string;
  status: IssueStatus;
  note: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  processes: string[];
  versions: string[];
  devices: string[];
}

export interface OccurrenceRef {
  id: number;
  ts: string;
  process: string;
  session_id: string | null;
  app_version: string;
  app_build: string;
  os_version: string;
  device_model: string;
  import_id: number;
  filename?: string;
}

export interface IssueDetail {
  id: number;
  kind: IssueKind;
  title: string;
  status: IssueStatus;
  note: string;
  occurrences: OccurrenceRef[];
}

export interface Frame {
  index: number | null;
  binary: string | null;
  in_app: boolean;
  address: string | null;
  offset: string | null;
  function: string | null;
  file: string | null;
  line: number | null;
  symbolicated: boolean;
  library: string | null;
  entry_point: boolean;
}

export interface Stack {
  name: string;
  crashed: boolean;
  reason: string | null;
  signal: string | null;
  frames: Frame[];
}

export interface TimelineEntry {
  id: number;
  ts: string;
  process: string;
  kind: 'event' | 'app_log' | 'span';
  event_type: string | null;
  level: string | null;
  category: string | null;
  message: string | null;
  session_id: string | null;
  import_id?: number;
  issue_id?: number | null;
}

export interface EntriesResponse {
  total: number;
  items: TimelineEntry[];
}

export interface Occurrence {
  id: number;
  kind: IssueKind;
  ts: string;
  window: { after: string; before: string; exact: boolean };
  process: string;
  session_id: string | null;
  duration_ms: number | null;
  foreground: boolean | null;
  context: Record<string, string | number | boolean | null>;
  stacks: Stack[];
  images: { name: string; uuid: string; arch: string; symbols: boolean }[];
  timeline: TimelineEntry[];
}

export interface ImportRow {
  id: number;
  filename: string;
  uploaded_at: string;
  uploaded_by: string;
  app_version: string;
  app_build: string;
  os_version: string;
  device_model: string;
  exported_at: string;
  flush_complete: boolean | null;
  entry_count: number;
  issue_count: number;
  expires_at: string;
}

export interface ImportResult {
  import_id: number;
  duplicate: boolean;
  inserted: number;
  skipped: number;
  issues: number;
}

export interface SymbolsOverview {
  uploaded: { debug_id: string; name: string; arch: string; size: number; uploaded_at: string; uploaded_by: string; versions: string[] }[];
  missing: { name: string; uuid: string; arch: string; app_version: string; app_build: string; issue_ids: number[]; issues: IssueRef[] }[];
}

export interface BuildRow {
  id: number;
  bundle_id: string;
  app_version: string;
  app_build: string;
  archived_at: string | null;
  archive_name: string | null;
  uploaded_at: string;
  uploaded_by: string;
  binaries: string[];
  issue_ids: number[];
  issues: IssueRef[];
  reported_versions: string[];
  variant: 'dev' | 'prod' | null;
}

export interface IssueRef {
  id: number;
  kind: IssueKind;
  title: string;
}
