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
import { Link as RouterLink, useLocation } from 'react-router-dom';

import { ExportUpload } from '../components/ExportUpload';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { ImportRow } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const COLUMNS = 8;

export function ImportsPage() {
  usePageTitle('Importe');
  const { hash } = useLocation();
  const imports = useResource(() => api<ImportRow[]>('/api/imports'), []);

  async function remove(row: ImportRow) {
    try {
      await api(`/api/imports/${row.id}`, { method: 'DELETE' });
      toast({ title: 'Import gelöscht', description: row.filename });
      imports.reload();
    } catch (reason) {
      toast({ variant: 'destructive', title: 'Import nicht gelöscht', description: `${(reason as Error).message}. Bitte erneut versuchen.` });
    }
  }

  return (
    <Stack gap="section">
      <PageHeader
        title="Importe"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-1">
            Jeder Export wird nur einmal übernommen. Importe werden nach Ablauf der Frist gelöscht.
            <HelpIcon
              label="Wie Importe zusammengeführt werden"
              content="Überlappende Exporte desselben Geräts ergänzen sich: Einträge, die schon importiert sind, werden übersprungen."
            />
          </span>
        }
      />
      <ExportUpload onImported={() => imports.reload()} />
      {imports.loading && !imports.data ? (
        <TableLoading columns={COLUMNS} rows={3} />
      ) : (
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Datei</TableHead>
              <TableHead className="hidden md:table-cell">Gerät</TableHead>
              <TableHead className="hidden md:table-cell">App</TableHead>
              <TableHead className="hidden lg:table-cell">Exportiert</TableHead>
              <TableHead className="hidden sm:table-cell">Inhalt</TableHead>
              <TableHead className="hidden lg:table-cell">Vollständig</TableHead>
              <TableHead className="hidden lg:table-cell">Wird gelöscht am</TableHead>
              <TableHead><span className="sr-only">Aktionen</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.error && <TableError columns={COLUMNS} title="Importe konnten nicht geladen werden" description={imports.error} onRetry={imports.reload} retryLabel="Erneut versuchen" />}
            {!imports.error && imports.data?.length === 0 && (
              <TableEmpty columns={COLUMNS} variant="first-use" title="Noch keine Importe" description="Ziehe einen Diagnose-Export in das Feld oben." />
            )}
            {imports.data?.map((row) => (
              <TableRow key={row.id} id={`import-${row.id}`} className={hash === `#import-${row.id}` ? 'bg-table-background-selected' : undefined} data-state={hash === `#import-${row.id}` ? 'selected' : undefined}>
                <TableCell className="break-words">
                  <Link asChild underline="hover" color="neutral">
                    <RouterLink to={`/timeline?import=${row.id}`}>{row.filename}</RouterLink>
                  </Link>
                  <div className="text-text-subtle">von {row.uploaded_by}, {formatDateTime(row.uploaded_at)}</div>
                  <div className="text-text-subtle md:hidden">{row.device_model}, App {row.app_version} ({row.app_build})</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{row.device_model}, iOS {row.os_version}</TableCell>
                <TableCell className="hidden md:table-cell">{row.app_version} ({row.app_build})</TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(row.exported_at)}</TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell">
                  <Link asChild underline="hover">
                    <RouterLink to={`/?status=all&import=${row.id}`}>{row.issue_count} {row.issue_count === 1 ? 'Issue' : 'Issues'}</RouterLink>
                  </Link>
                  <span className="text-text-subtle"> · </span>
                  <Link asChild underline="hover">
                    <RouterLink to={`/timeline?import=${row.id}`}>{row.entry_count.toLocaleString('de-DE')} Einträge</RouterLink>
                  </Link>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {row.flush_complete === false ? (
                    <span title="Die App konnte die letzten Measure-Ereignisse vor dem Export nicht mehr übergeben.">
                      <Badge variant="warning" tinted>unvollständig</Badge>
                    </span>
                  ) : (
                    <Badge variant="success" tinted>ja</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(row.expires_at)}</TableCell>
                <TableCell className="text-right">
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm">Löschen</Button>}
                    title="Import löschen?"
                    description={`${row.filename} und alle daraus übernommenen Einträge werden endgültig gelöscht.`}
                    tone="destructive"
                    confirmLabel="Löschen"
                    cancelLabel="Abbrechen"
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
