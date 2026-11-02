import {
  Alert,
  AlertDescription,
  Badge,
  CodeSnippet,
  FileUpload,
  Link,
  PageHeader,
  PanelSectionHeader,
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
import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';

import { api, upload } from '../lib/api';
import { formatBytes, formatDateMinutes, formatDateTime } from '../lib/format';
import type { BuildRow, IssueRef, SymbolsOverview } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { readableError } from '../lib/issueList';
import { useResource } from '../lib/useResource';

const WATCHER_COMMAND = 'tools/install-archive-watcher.sh';
const ZIP_COMMAND = 'cd ~/Library/Developer/Xcode/Archives/<date>/<App>*.xcarchive && zip -r ~/Desktop/dsyms.zip dSYMs';

// Xcode names archives "<App> 27.10.26, 08.05", which only repeats the archive time
const XCODE_DEFAULT_NAME = /^\S+ \d{2}\.\d{2}\.\d{2}, \d{2}\.\d{2}( \d+)?$/;

function IssueLinks({ issues }: { issues: IssueRef[] }) {
  if (issues.length === 0) return <span className="text-text-subtle">none</span>;
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Link asChild underline="hover">
            <RouterLink to={`/issues/${issue.id}`} title={`Issue ${issue.id}`}>
              {issue.kind === 'crash' ? 'Crash' : 'Hang'}: {issue.title}
            </RouterLink>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Manual uploads have no archive time, then the upload time is shown and named as such
const buildTime = (build: BuildRow) =>
  build.archived_at ? `Archived ${formatDateMinutes(build.archived_at)}` : `Uploaded ${formatDateMinutes(build.uploaded_at)}`;

function BuildVersion({ build }: { build: BuildRow }) {
  const own = `${build.app_version} (${build.app_build})`;
  const renumbered = build.reported_versions.filter((version) => version !== own);
  const customName = build.archive_name && !XCODE_DEFAULT_NAME.test(build.archive_name) ? build.archive_name : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span>{own}</span>
        {build.variant && <Badge variant={build.variant === 'prod' ? 'info' : 'secondary'} tinted>{build.variant === 'prod' ? 'Prod' : 'Dev'}</Badge>}
      </div>
      {renumbered.length > 0 && <div className="text-text-subtle">Reported in crashes as {renumbered.join(', ')}</div>}
      {customName && <div className="text-text-subtle">{customName}</div>}
      <div className="text-text-subtle md:hidden">{buildTime(build)}</div>
    </>
  );
}

export function SymbolsPage() {
  usePageTitle('Symbols');
  const [params] = useSearchParams();
  const returnTo = params.get('from')?.startsWith('/') ? params.get('from') : null;
  const symbols = useResource(() => api<SymbolsOverview>('/api/symbols'), []);
  const builds = useResource(() => api<BuildRow[]>('/api/builds'), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleFiles(files: File[]) {
    setLoading(true);
    setError(null);
    try {
      let count = 0;
      for (const file of files) count += (await upload<{ stored: unknown[] }>('/api/symbols', file)).stored.length;
      toast({ title: `${count} ${count === 1 ? 'binary' : 'binaries'} now readable`, description: 'The build is at the top of the list, issues were regrouped.' });
      setDone(true);
      symbols.reload();
      builds.reload();
    } catch (reason) {
      setError(`Upload failed: ${(reason as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="section">
      <PageHeader
        title="Symbols (dSYMs)"
        subtitle="With the dSYMs of a build, addresses become function, file and line. Only a compact symbol table is stored."
      />
      {returnTo && done && (
        <Alert variant="success">
          <AlertDescription>
            Symbols are uploaded.{' '}
            <Link asChild underline="always" color="inherit">
              <RouterLink to={returnTo}>Back to the issue</RouterLink>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Stack gap="block">
        <PanelSectionHeader
          title="Builds"
          titleAs="h2"
          description="Every build whose dSYMs are available. To have every new archive land here automatically, run this once on the Mac in the measure-local-diagnostics repo:"
        />
        <CodeSnippet code={WATCHER_COMMAND} language="bash" copy copyLabel="Copy" copiedLabel="Copied" />
        {builds.loading && !builds.data ? (
          <TableLoading columns={3} rows={2} />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="hidden md:table-cell">Time</TableHead>
                <TableHead>Crashes and hangs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {builds.error && <TableError columns={3} title="Builds could not be loaded" description={readableError(builds.error)} onRetry={builds.reload} retryLabel="Try again" />}
              {!builds.error && builds.data?.length === 0 && (
                <TableEmpty columns={3} variant="first-use" title="No builds yet" description="Set up automatic uploads with the command above or upload a dSYM ZIP below." />
              )}
              {builds.data?.map((build) => (
                <TableRow key={build.id}>
                  <TableCell className="break-words" title={build.binaries.length ? `Binaries: ${build.binaries.join(', ')}` : undefined}>
                    <BuildVersion build={build} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">{buildTime(build)}</TableCell>
                  <TableCell className="break-words">
                    <IssueLinks issues={build.issues} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>

      {symbols.loading && !symbols.data ? (
        <TableLoading columns={3} rows={3} />
      ) : (
        <Stack gap="block">
          <PanelSectionHeader title="Missing symbols" titleAs="h2" description="Own binaries from imported crashes and hangs that have no dSYMs yet." />
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Binary</TableHead>
                <TableHead className="hidden md:table-cell">UUID</TableHead>
                <TableHead>Affected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {symbols.error && <TableError columns={3} title="Symbols could not be loaded" description={readableError(symbols.error)} onRetry={symbols.reload} retryLabel="Try again" />}
              {!symbols.error && symbols.data?.missing.length === 0 && <TableEmpty columns={3} title="Nothing missing" description="All own binaries from imported crashes and hangs are readable." />}
              {symbols.data?.missing.map((image) => (
                <TableRow key={image.uuid}>
                  <TableCell className="break-words">
                    {image.name}
                    <div className="text-text-subtle">App {image.app_version} ({image.app_build}), {image.arch}</div>
                    <div className="font-mono text-text-subtle break-all md:hidden">{image.uuid}</div>
                  </TableCell>
                  <TableCell className="hidden font-mono md:table-cell">{image.uuid}</TableCell>
                  <TableCell className="break-words">
                    <IssueLinks issues={image.issues} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      )}

      <Stack gap="block">
        <PanelSectionHeader title="Upload manually" titleAs="h2" description="Zip the dSYMs from the Xcode archive of the matching build and drop them here." />
        <CodeSnippet code={ZIP_COMMAND} language="bash" copy copyLabel="Copy" copiedLabel="Copied" />
        <FileUpload
          accept=".zip,application/zip"
          multiple
          loading={loading}
          loadingText="Processing symbols …"
          titleText="Drop a dSYM ZIP here or choose one"
          descriptionText="ZIP with one or more .dSYM bundles"
          error={error}
          onFilesSelected={handleFiles}
        />
      </Stack>

      {symbols.data && (
        <Stack gap="block">
          <PanelSectionHeader title="Uploaded" titleAs="h2" />
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Binary</TableHead>
                <TableHead className="hidden md:table-cell">UUID</TableHead>
                <TableHead className="hidden sm:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {symbols.data.uploaded.length === 0 && <TableEmpty columns={4} title="No symbols yet" />}
              {symbols.data.uploaded.map((row) => (
                <TableRow key={row.debug_id}>
                  <TableCell className="break-words">
                    {row.name} <span className="text-text-subtle">{row.arch}</span>
                    <div className="text-text-subtle">{row.versions.length ? `App ${row.versions.join(', ')}` : 'Not used in any import'}</div>
                  </TableCell>
                  <TableCell className="hidden font-mono md:table-cell">{row.debug_id}</TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">{formatBytes(row.size)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDateTime(row.uploaded_at)} by {row.uploaded_by}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      )}
    </Stack>
  );
}
