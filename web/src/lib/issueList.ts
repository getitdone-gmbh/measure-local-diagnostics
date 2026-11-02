import { api } from './api';
import type { IssueSummary } from './types';

export const STATUS_FILTERS = {
  active: { label: 'Offen und in Analyse', match: (issue: IssueSummary) => issue.status === 'open' || issue.status === 'investigating' },
  all: { label: 'Alle', match: () => true },
  resolved: { label: 'Behoben', match: (issue: IssueSummary) => issue.status === 'resolved' },
  ignored: { label: 'Ignoriert', match: (issue: IssueSummary) => issue.status === 'ignored' },
} as const;
export type StatusFilter = keyof typeof STATUS_FILTERS;

export function statusFilter(params: URLSearchParams): StatusFilter {
  const value = params.get('status');
  return value && value in STATUS_FILTERS ? (value as StatusFilter) : 'active';
}

// The list query travels with the detail link, so back and previous/next keep the filter
export function fetchIssueList(params: URLSearchParams): Promise<IssueSummary[]> {
  const importId = params.get('import');
  return api<IssueSummary[]>(`/api/issues${importId ? `?import_id=${encodeURIComponent(importId)}` : ''}`).then((issues) =>
    issues.filter(STATUS_FILTERS[statusFilter(params)].match),
  );
}

export function issueHref(id: number, listQuery: string): string {
  return listQuery ? `/issues/${id}?from=${encodeURIComponent(listQuery)}` : `/issues/${id}`;
}

// API errors arrive as English server text; the page shows German
export function germanError(message: string): string {
  if (/not found/i.test(message)) return 'Nicht gefunden. Der Eintrag wurde gelöscht oder die Adresse ist falsch.';
  if (/failed to fetch|network/i.test(message)) return 'Keine Verbindung zum Server.';
  if (/401|unauthor|token/i.test(message)) return 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.';
  return 'Der Server hat einen Fehler gemeldet.';
}
