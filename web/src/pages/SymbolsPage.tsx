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
import { germanError } from '../lib/issueList';
import { useResource } from '../lib/useResource';

const WATCHER_COMMAND = 'tools/install-archive-watcher.sh';
const ZIP_COMMAND = 'cd ~/Library/Developer/Xcode/Archives/<Datum>/<App>*.xcarchive && zip -r ~/Desktop/dsyms.zip dSYMs';

// Xcode names archives "<App> 27.10.26, 08.05", which only repeats the archive time
const XCODE_DEFAULT_NAME = /^\S+ \d{2}\.\d{2}\.\d{2}, \d{2}\.\d{2}( \d+)?$/;

function IssueLinks({ issues }: { issues: IssueRef[] }) {
  if (issues.length === 0) return <span className="text-text-subtle">keine</span>;
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Link asChild underline="hover">
            <RouterLink to={`/issues/${issue.id}`} title={`Issue ${issue.id}`}>
              {issue.kind === 'crash' ? 'Absturz' : 'Hänger'}: {issue.title}
            </RouterLink>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Manual uploads have no archive time, then the upload time is shown and named as such
const buildTime = (build: BuildRow) =>
  build.archived_at ? `Archiviert ${formatDateMinutes(build.archived_at)}` : `Hochgeladen ${formatDateMinutes(build.uploaded_at)}`;

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
      {renumbered.length > 0 && <div className="text-text-subtle">In Abstürzen gemeldet als {renumbered.join(', ')}</div>}
      {customName && <div className="text-text-subtle">{customName}</div>}
      <div className="text-text-subtle md:hidden">{buildTime(build)}</div>
    </>
  );
}

export function SymbolsPage() {
  usePageTitle('Symbole');
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
      toast({ title: `${count} Binaries jetzt lesbar`, description: 'Der Build steht oben in der Liste, Issues wurden neu gruppiert.' });
      setDone(true);
      symbols.reload();
      builds.reload();
    } catch (reason) {
      setError(`Upload fehlgeschlagen: ${(reason as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="section">
      <PageHeader
        title="Symbole (dSYMs)"
        subtitle="Mit den dSYMs eines Builds werden Adressen zu Funktion, Datei und Zeile. Gespeichert wird nur eine kompakte Symboltabelle."
      />
      {returnTo && done && (
        <Alert variant="success">
          <AlertDescription>
            Symbole sind hochgeladen.{' '}
            <Link asChild underline="always" color="inherit">
              <RouterLink to={returnTo}>Zurück zum Issue</RouterLink>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Stack gap="block">
        <PanelSectionHeader
          title="Builds"
          titleAs="h2"
          description="Jeder Build, dessen dSYMs vorliegen. Damit jedes neue Archiv automatisch hier landet, einmal auf dem Mac im Repo measure-local-diagnostics ausführen:"
        />
        <CodeSnippet code={WATCHER_COMMAND} language="bash" copy copyLabel="Kopieren" copiedLabel="Kopiert" />
        {builds.loading && !builds.data ? (
          <TableLoading columns={3} rows={2} />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="hidden md:table-cell">Zeitpunkt</TableHead>
                <TableHead>Abstürze und Hänger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {builds.error && <TableError columns={3} title="Builds konnten nicht geladen werden" description={germanError(builds.error)} onRetry={builds.reload} retryLabel="Erneut versuchen" />}
              {!builds.error && builds.data?.length === 0 && (
                <TableEmpty columns={3} variant="first-use" title="Noch keine Builds" description="Richte mit dem Befehl oben das automatische Hochladen ein oder lade unten eine dSYM-ZIP hoch." />
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
          <PanelSectionHeader title="Fehlende Symbole" titleAs="h2" description="Eigene Binaries aus importierten Abstürzen und Hängern, für die noch keine dSYMs vorliegen." />
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Binary</TableHead>
                <TableHead className="hidden md:table-cell">UUID</TableHead>
                <TableHead>Betroffen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {symbols.error && <TableError columns={3} title="Symbole konnten nicht geladen werden" description={germanError(symbols.error)} onRetry={symbols.reload} retryLabel="Erneut versuchen" />}
              {!symbols.error && symbols.data?.missing.length === 0 && <TableEmpty columns={3} title="Nichts fehlt" description="Alle eigenen Binaries aus importierten Abstürzen und Hängern sind lesbar." />}
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
        <PanelSectionHeader title="Manuell hochladen" titleAs="h2" description="dSYMs aus dem Xcode-Archiv des passenden Builds als ZIP packen und hier ablegen." />
        <CodeSnippet code={ZIP_COMMAND} language="bash" copy copyLabel="Kopieren" copiedLabel="Kopiert" />
        <FileUpload
          accept=".zip,application/zip"
          multiple
          loading={loading}
          loadingText="Symbole werden verarbeitet …"
          titleText="dSYM-ZIP hierher ziehen oder auswählen"
          descriptionText="ZIP mit einem oder mehreren .dSYM-Bundles"
          error={error}
          onFilesSelected={handleFiles}
        />
      </Stack>

      {symbols.data && (
        <Stack gap="block">
          <PanelSectionHeader title="Hochgeladen" titleAs="h2" />
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Binary</TableHead>
                <TableHead className="hidden md:table-cell">UUID</TableHead>
                <TableHead className="hidden sm:table-cell">Größe</TableHead>
                <TableHead className="hidden lg:table-cell">Hochgeladen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {symbols.data.uploaded.length === 0 && <TableEmpty columns={4} title="Noch keine Symbole" />}
              {symbols.data.uploaded.map((row) => (
                <TableRow key={row.debug_id}>
                  <TableCell className="break-words">
                    {row.name} <span className="text-text-subtle">{row.arch}</span>
                    <div className="text-text-subtle">{row.versions.length ? `App ${row.versions.join(', ')}` : 'In keinem Import verwendet'}</div>
                  </TableCell>
                  <TableCell className="hidden font-mono md:table-cell">{row.debug_id}</TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">{formatBytes(row.size)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDateTime(row.uploaded_at)} von {row.uploaded_by}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      )}
    </Stack>
  );
}
