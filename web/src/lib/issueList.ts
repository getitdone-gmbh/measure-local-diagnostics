import { api } from './api';
import type { IssueSummary } from './types';

export const STATUS_FILTERS = {
  active: { label: 'Open and investigating', match: (issue: IssueSummary) => issue.status === 'open' || issue.status === 'investigating' },
  all: { label: 'All', match: () => true },
  resolved: { label: 'Resolved', match: (issue: IssueSummary) => issue.status === 'resolved' },
  ignored: { label: 'Ignored', match: (issue: IssueSummary) => issue.status === 'ignored' },
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

// API errors arrive as raw server text; the page shows a short readable sentence
export function readableError(message: string): string {
  if (/not found/i.test(message)) return 'Not found. The item was deleted or the address is wrong.';
  if (/failed to fetch|network/i.test(message)) return 'No connection to the server.';
  if (/401|unauthor|token/i.test(message)) return 'Your session has expired. Please sign in again.';
  return 'The server reported an error.';
}
