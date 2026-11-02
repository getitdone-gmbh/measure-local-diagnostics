import {
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
import type { IssueSummary } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const COLUMNS = 7;
const STATUS_FILTERS = {
  active: { label: 'Offen und in Analyse', match: (issue: IssueSummary) => issue.status === 'open' || issue.status === 'investigating' },
  all: { label: 'Alle', match: () => true },
  resolved: { label: 'Behoben', match: (issue: IssueSummary) => issue.status === 'resolved' },
  ignored: { label: 'Ignoriert', match: (issue: IssueSummary) => issue.status === 'ignored' },
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

export function IssuesPage() {
  usePageTitle('Issues');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('status') as StatusFilter) in STATUS_FILTERS ? (params.get('status') as StatusFilter) : 'active';
  const issues = useResource(() => api<IssueSummary[]>('/api/issues'), []);
  const visible = issues.data?.filter(STATUS_FILTERS[filter].match) ?? [];
  const hidden = (issues.data?.length ?? 0) - visible.length;

  return (
    <Stack gap="section">
      <PageHeader title="Abstürze und Hänger" subtitle="Gleiche Fehler werden über die obersten eigenen Frames zu einem Issue zusammengefasst." />
      <ExportUpload onImported={issues.reload} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-text-subtle">Status</span>
        <Select value={filter} onValueChange={(value) => setParams(value === 'active' ? {} : { status: value }, { replace: true })}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Nach Status filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_FILTERS).map(([value, option]) => (
              <SelectItem key={value} value={value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hidden > 0 && <span className="text-text-subtle">{hidden} weitere ausgeblendet</span>}
      </div>
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
            {issues.error && <TableError columns={COLUMNS} title="Issues konnten nicht geladen werden" description={issues.error} onRetry={issues.reload} retryLabel="Erneut versuchen" />}
            {!issues.error && issues.data?.length === 0 && (
              <TableEmpty
                columns={COLUMNS}
                variant="first-use"
                title="Noch keine Abstürze oder Hänger"
                description="Importiere einen Diagnose-Export aus der App. Abstürze und Hänger erscheinen dann hier."
              />
            )}
            {!issues.error && issues.data && issues.data.length > 0 && visible.length === 0 && (
              <TableEmpty columns={COLUMNS} variant="no-results" title="Keine Issues mit diesem Status" description="Wähle oben einen anderen Status." />
            )}
            {visible.map((issue) => (
              <TableRow key={issue.id} onClick={() => navigate(`/issues/${issue.id}`)}>
                <TableCell className="hidden sm:table-cell">
                  <KindBadge kind={issue.kind} />
                </TableCell>
                <TableCell className="break-words">
                  <Link asChild underline="hover" color="neutral">
                    <RouterLink to={`/issues/${issue.id}`} onClick={(event) => event.stopPropagation()}>{issue.title}</RouterLink>
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
