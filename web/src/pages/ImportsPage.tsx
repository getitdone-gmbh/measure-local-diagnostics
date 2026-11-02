import {
  Badge,
  Button,
  ConfirmDialog,
  HelpIcon,
  Link,
  PageHeader,
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
  toast,
} from '@getitdone-gmbh/kette-design-community';
import { useEffect } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';

import { ExportUpload } from '../components/ExportUpload';
import { api } from '../lib/api';
import { formatDateTime, plural } from '../lib/format';
import { readableError } from '../lib/issueList';
import type { ImportRow } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const COLUMNS = 7;

export function ImportsPage() {
  usePageTitle('Imports');
  const { hash } = useLocation();
  const navigate = useNavigate();
  const imports = useResource(() => api<ImportRow[]>('/api/imports'), []);
  useEffect(() => {
    if (hash && imports.data) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [hash, imports.data]);

  async function remove(row: ImportRow) {
    try {
      await api(`/api/imports/${row.id}`, { method: 'DELETE' });
      toast({ title: 'Import deleted', description: row.filename });
      imports.reload();
    } catch (reason) {
      toast({ variant: 'destructive', title: 'Import not deleted', description: `${readableError((reason as Error).message)} Please try again.` });
    }
  }

  return (
    <Stack gap="section">
      <PageHeader
        title="Imports"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-1">
            Each export is imported only once. Imports are deleted when their retention period ends.
            <HelpIcon
              label="How imports are merged"
              content="Overlapping exports from the same device complement each other: entries that are already imported are skipped."
            />
          </span>
        }
      />
      <ExportUpload
        onImported={(ids) => {
          imports.reload();
          if (ids.length === 1) navigate(`/imports#import-${ids[0]}`, { replace: true });
        }}
      />
      {imports.loading && !imports.data ? (
        <TableLoading columns={COLUMNS} rows={3} />
      ) : (
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="hidden md:table-cell">Device</TableHead>
              <TableHead className="hidden md:table-cell">App</TableHead>
              <TableHead className="hidden lg:table-cell">Exported</TableHead>
              <TableHead className="hidden lg:table-cell">Complete</TableHead>
              <TableHead className="hidden lg:table-cell">Kept until</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.error && <TableError columns={COLUMNS} title="Imports could not be loaded" description={readableError(imports.error)} onRetry={imports.reload} retryLabel="Try again" />}
            {!imports.error && imports.data?.length === 0 && (
              <TableEmpty columns={COLUMNS} variant="first-use" title="No imports yet" description="Drop a diagnostics export into the field above." />
            )}
            {imports.data?.map((row) => (
              <TableRow key={row.id} id={`import-${row.id}`} className={hash === `#import-${row.id}` ? 'bg-table-background-selected' : undefined} data-state={hash === `#import-${row.id}` ? 'selected' : undefined}>
                <TableCell className="break-words">
                  <Link asChild underline="hover" color="neutral">
                    <RouterLink to={`/timeline?import=${row.id}`}>{row.filename}</RouterLink>
                  </Link>
                  <div className="text-text-subtle">by {row.uploaded_by}, {formatDateTime(row.uploaded_at)}</div>
                  <div className="text-text-subtle md:hidden">{row.device_model}, App {row.app_version} ({row.app_build})</div>
                  <ImportContent row={row} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{row.device_model}, iOS {row.os_version}</TableCell>
                <TableCell className="hidden md:table-cell">{row.app_version} ({row.app_build})</TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(row.exported_at)}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {row.flush_complete === false ? (
                    <span title="The app could not hand over the last Measure events before the export.">
                      <Badge variant="warning" tinted>Incomplete</Badge>
                    </span>
                  ) : (
                    <Badge variant="success" tinted>Yes</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(row.expires_at)}</TableCell>
                <TableCell className="text-right">
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm">Delete</Button>}
                    title="Delete import?"
                    description={`${row.filename} and all entries imported from it will be deleted permanently.`}
                    tone="destructive"
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                    onConfirm={() => remove(row)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}

// What one export brought in, each count leads to exactly that part
function ImportContent({ row }: { row: ImportRow }) {
  return (
    <div>
      <Link asChild underline="hover">
        <RouterLink to={`/?status=all&import=${row.id}`}>{plural(row.issue_count, 'issue')}</RouterLink>
      </Link>
      <span className="text-text-subtle"> · </span>
      <Link asChild underline="hover">
        <RouterLink to={`/timeline?import=${row.id}`}>{plural(row.entry_count, 'entry', 'entries')}</RouterLink>
      </Link>
    </div>
  );
}
