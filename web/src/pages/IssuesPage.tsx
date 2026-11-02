import {
  ActionBar,
  ActionBarRow,
  Button,
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
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';

import { ExportUpload } from '../components/ExportUpload';
import { KindBadge, StatusBadge } from '../components/IssueBadges';
import { api } from '../lib/api';
import { formatDateTime, processLabel } from '../lib/format';
import { STATUS_FILTERS, germanError, issueHref, statusFilter, type StatusFilter } from '../lib/issueList';
import type { ImportRow, IssueSummary } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const COLUMNS = 7;
export function IssuesPage() {
  usePageTitle('Issues');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter: StatusFilter = statusFilter(params);
  const importId = params.get('import');
  const issues = useResource(() => api<IssueSummary[]>(`/api/issues${importId ? `?import_id=${importId}` : ''}`), [importId]);
  const imports = useResource(() => api<ImportRow[]>('/api/imports'), []);
  const listQuery = params.toString();
  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const visible = issues.data?.filter(STATUS_FILTERS[filter].match) ?? [];
  const hidden = (issues.data?.length ?? 0) - visible.length;

  return (
    <Stack gap="section">
      <PageHeader
        title="Issues"
        subtitle="Abstürze und Hänger aus allen Importen. Gleiche Fehler werden über die obersten eigenen Frames zusammengefasst."
        primaryAction={
          <Button asChild>
            <RouterLink to="/imports">Export importieren</RouterLink>
          </Button>
        }
      />
      {imports.data?.length === 0 && (
        <ExportUpload
          onImported={(ids) => {
            imports.reload();
            // A new export can bring back resolved issues, so the list shows every status
            setParams(ids.length === 1 ? { status: 'all', import: String(ids[0]) } : { status: 'all' }, { replace: true });
          }}
        />
      )}
      <ActionBar>
        <ActionBarRow className="flex-wrap">
        <Select value={filter} onValueChange={(value) => update('status', value === 'active' ? null : value)}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Nach Status filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_FILTERS).map(([value, option]) => (
              <SelectItem key={value} value={value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={importId ?? 'all'} onValueChange={(value) => update('import', value === 'all' ? null : value)}>
          <SelectTrigger className="w-full sm:w-80" aria-label="Nach Import filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Importe</SelectItem>
            {(imports.data ?? []).map((row) => (
              <SelectItem key={row.id} value={String(row.id)}>{row.filename}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hidden > 0 && <span className="typography-small text-text-subtle">{hidden} weitere ausgeblendet</span>}
        </ActionBarRow>
      </ActionBar>
      {issues.loading && !issues.data ? (
        <TableLoading columns={COLUMNS} rows={4} />
      ) : (
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell">Art</TableHead>
              <TableHead>Fehler</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden text-right md:table-cell">Vorkommen</TableHead>
              <TableHead className="hidden md:table-cell">Zuletzt</TableHead>
              <TableHead className="hidden lg:table-cell">Versionen</TableHead>
              <TableHead className="hidden lg:table-cell">Prozess</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.error && <TableError columns={COLUMNS} title="Issues konnten nicht geladen werden" description={germanError(issues.error)} onRetry={issues.reload} retryLabel="Erneut versuchen" />}
            {!issues.error && issues.data?.length === 0 && (
              <TableEmpty
                columns={COLUMNS}
                variant="first-use"
                title="Noch keine Abstürze oder Hänger"
                description="Importiere einen Diagnose-Export aus der App. Abstürze und Hänger erscheinen dann hier."
              />
            )}
            {!issues.error && issues.data && issues.data.length > 0 && visible.length === 0 && (
              <TableEmpty columns={COLUMNS} variant="no-results" title="Keine Issues für diese Auswahl" description="Wähle oben einen anderen Status oder Import." />
            )}
            {visible.map((issue) => (
              <TableRow key={issue.id} onClick={() => navigate(issueHref(issue.id, listQuery))}>
                <TableCell className="hidden sm:table-cell">
                  <KindBadge kind={issue.kind} />
                </TableCell>
                <TableCell className="break-words">
                  <Link asChild underline="hover" color="neutral">
                    <RouterLink to={issueHref(issue.id, listQuery)} onClick={(event) => event.stopPropagation()}>{issue.title}</RouterLink>
                  </Link>
                  <div className="text-text-subtle md:hidden">
                    {issue.occurrences}× · {formatDateTime(issue.last_seen)}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={issue.status} />
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{issue.occurrences}</TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">{formatDateTime(issue.last_seen)}</TableCell>
                <TableCell className="hidden lg:table-cell">{issue.versions.join(', ')}</TableCell>
                <TableCell className="hidden lg:table-cell">{issue.processes.map(processLabel).join(', ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}
