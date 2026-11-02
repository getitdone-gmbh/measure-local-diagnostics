import {
  Button,
  Input,
  Link,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@getitdone-gmbh/kette-design-community';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';

import { EntryBadge } from '../components/IssueBadges';
import { api } from '../lib/api';
import { formatDateTime, processLabel } from '../lib/format';
import { germanError } from '../lib/issueList';
import type { EntriesResponse, ImportRow } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const ALL = 'all';
const COLUMNS = 4;
const LIMIT = 500;
const FILTER_KEYS = ['import', 'process', 'kind', 'level', 'q', 'from', 'to'] as const;
// A time window is read like a story, oldest first; the open list shows the newest first

// Filters live in the URL so a filtered view can be shared as a link
export function TimelinePage() {
  usePageTitle('Einträge');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const imports = useResource(() => api<ImportRow[]>('/api/imports'), []);
  const entries = useResource(() => {
    const query = new URLSearchParams({ limit: String(LIMIT) });
    const mapping: Record<string, string> = { import: 'import_id' };
    FILTER_KEYS.forEach((key) => params.get(key) && query.set(mapping[key] ?? key, params.get(key)!));
    if (params.get('from') && params.get('to')) query.set('order', 'asc');
    return api<EntriesResponse>(`/api/entries?${query}`);
  }, [params.toString()]);
  const hasFilter = FILTER_KEYS.some((key) => params.get(key));
  const highlighted = Number(params.get('entry')) || null;
  const windowed = Boolean(params.get('from') && params.get('to'));

  useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }

  const select = (key: string, label: string, options: [string, string][]) => (
    <Select value={params.get(key) ?? ALL} onValueChange={(value) => update(key, value)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: alle</SelectItem>
        {options.map(([value, text]) => (
          <SelectItem key={value} value={value}>{text}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const total = entries.data?.total ?? 0;
  const shown = entries.data?.items.length ?? 0;

  return (
    <Stack gap="section">
      <PageHeader title="Einträge" subtitle={windowed ? 'Alle Zeilen im gewählten Zeitraum, älteste zuerst.' : 'Alle Zeilen aus allen Importen, neueste zuerst: Logs, Bedienschritte, Netzwerk, Abstürze.'} />
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update('q', search.trim());
        }}
      >
        <Input placeholder="Suchen, mit Enter bestätigen" value={search} onChange={(event) => setSearch(event.target.value)} onBlur={() => update('q', search.trim())} aria-label="Suchen in Nachricht, Kategorie und Typ" />
        {select('import', 'Import', (imports.data ?? []).map((row) => [String(row.id), row.filename]))}
        {select('process', 'Prozess', [['app', 'App'], ['autofill', 'Autofill-Extension']])}
        {select('kind', 'Art', [['app_log', 'App-Logs'], ['event', 'Measure-Ereignisse'], ['span', 'Messungen']])}
        {select('level', 'Level', [['debug', 'debug'], ['info', 'info'], ['notice', 'notice'], ['warning', 'warning'], ['error', 'error'], ['fault', 'fault']])}
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <span className="typography-small text-text-subtle" aria-live="polite">
          {entries.data ? (total > shown ? `${total.toLocaleString('de-DE')} Einträge, ${windowed ? 'die ersten' : 'die neuesten'} ${shown} werden gezeigt` : `${total.toLocaleString('de-DE')} Einträge`) : ''}
          {params.get('from') && params.get('to') ? `, Zeitraum ${formatDateTime(params.get('from'))} bis ${formatDateTime(params.get('to'))}` : ''}
        </span>
        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            Filter zurücksetzen
          </Button>
        )}
      </div>
      {entries.loading && !entries.data ? (
        <TableLoading columns={COLUMNS} rows={8} />
      ) : (
        <Table density="compact" stickyHeader maxHeight="75vh">
          <TableHeader>
            <TableRow>
              <TableHead className="hidden w-44 sm:table-cell">Zeit</TableHead>
              <TableHead className="hidden w-40 md:table-cell">Prozess</TableHead>
              <TableHead className="hidden w-36 sm:table-cell">Typ</TableHead>
              <TableHead>Inhalt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.error && <TableError columns={COLUMNS} title="Einträge konnten nicht geladen werden" description={germanError(entries.error)} onRetry={entries.reload} retryLabel="Erneut versuchen" />}
            {!entries.error && shown === 0 && <TableEmpty columns={COLUMNS} variant="no-results" title="Keine Einträge" description="Passe die Filter an oder importiere einen Export." />}
            {entries.data?.items.map((entry) => (
              <TableRow
                key={entry.id}
                className={entry.id === highlighted ? 'bg-table-background-selected' : undefined}
                data-state={entry.id === highlighted ? 'selected' : undefined}
                aria-current={entry.id === highlighted ? 'true' : undefined}
              >
                <TableCell className="hidden tabular-nums sm:table-cell">{formatDateTime(entry.ts)}</TableCell>
                <TableCell className="hidden md:table-cell">{processLabel(entry.process)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <EntryBadge entry={entry} />
                </TableCell>
                <TableCell className="[overflow-wrap:anywhere]">
                  <div className="mb-1 flex flex-wrap items-center gap-2 sm:hidden">
                    <span className="tabular-nums text-text-subtle">{formatDateTime(entry.ts)}</span>
                    <EntryBadge entry={entry} />
                  </div>
                  {entry.kind === 'app_log' && entry.category ? <span className="text-text-subtle">{entry.category}: </span> : null}
                  {entry.issue_id ? (
                    <Link asChild underline="always" color="neutral">
                      <RouterLink to={`/issues/${entry.issue_id}`}>{entry.message}</RouterLink>
                    </Link>
                  ) : (
                    entry.message
                  )}
                  <div className="text-text-subtle md:hidden">{processLabel(entry.process)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}
