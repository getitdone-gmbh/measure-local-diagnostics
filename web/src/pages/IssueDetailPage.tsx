import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Attribute,
  Attributes,
  Badge,
  Button,
  DataStatePanel,
  HelpIcon,
  Label,
  Link,
  PageHeader,
  PanelSectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@getitdone-gmbh/kette-design-community';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';

import { EntryBadge, KindBadge, statusLabels } from '../components/IssueBadges';
import { api } from '../lib/api';
import {
  crashTimeLabel,
  formatDateTime,
  formatTime,
  frameLabel,
  frameLocation,
  occurrenceToMarkdown,
  processLabel,
  referenceTime,
  relativeSeconds,
} from '../lib/format';
import type { Frame, IssueDetail, IssueStatus, Occurrence, Stack as CrashStack, TimelineEntry } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const TABS = ['stack', 'timeline', 'images'] as const;
type Tab = (typeof TABS)[number];

const LIBRARY_NAMES: Record<string, string> = { measure: 'Measure SDK', kscrash: 'KSCrash', kscrashrecording: 'KSCrash', swiftcbor: 'SwiftCBOR' };

export function IssueDetailPage() {
  const { issueId } = useParams();
  const [params, setParams] = useSearchParams();
  const issue = useResource(() => api<IssueDetail>(`/api/issues/${issueId}`), [issueId]);
  const occurrenceParam = Number(params.get('occurrence')) || null;
  const occurrenceId = occurrenceParam ?? issue.data?.occurrences[0]?.id ?? null;
  usePageTitle(issue.data?.title ?? 'Issue');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  if (issue.error) {
    const notFound = /not found/i.test(issue.error);
    return (
      <DataStatePanel
        kind={notFound ? 'empty' : 'error'}
        title={notFound ? 'Issue nicht gefunden' : 'Issue konnte nicht geladen werden'}
        description={notFound ? 'Das Issue wurde gelöscht oder die Adresse ist falsch.' : issue.error}
        onRetry={notFound ? undefined : issue.reload}
        retryLabel="Erneut versuchen"
        action={
          <Button asChild variant="secondary">
            <RouterLink to="/">Zur Issue-Liste</RouterLink>
          </Button>
        }
      />
    );
  }
  if (!issue.data) return <TableLoading columns={4} rows={6} />;

  return (
    <Stack gap="section">
      <PageHeader
        title={issue.data.title}
        titleAs="h1"
        breadcrumbs={
          <Link asChild underline="hover" color="neutral">
            <RouterLink to="/">Alle Issues</RouterLink>
          </Link>
        }
        badges={<KindBadge kind={issue.data.kind} />}
        actions={<IssueStatusSelect issue={issue.data} onSaved={issue.reload} />}
      />
      <IssueNote issue={issue.data} />
      {issue.data.occurrences.length > 1 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Label htmlFor="occurrence">Vorkommen ({issue.data.occurrences.length})</Label>
          <Select value={occurrenceId ? String(occurrenceId) : undefined} onValueChange={(value) => setParam('occurrence', value)}>
            <SelectTrigger id="occurrence" className="w-full sm:max-w-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {issue.data.occurrences.map((occurrence) => (
                <SelectItem key={occurrence.id} value={String(occurrence.id)}>
                  {formatDateTime(occurrence.ts)}, {processLabel(occurrence.process)}, {occurrence.app_version} ({occurrence.app_build}), {occurrence.device_model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {occurrenceId && (
        <OccurrenceView
          key={occurrenceId}
          occurrenceId={occurrenceId}
          title={issue.data.title}
          tab={(TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'stack'}
          onTabChange={(tab) => setParam('tab', tab === 'stack' ? null : tab)}
        />
      )}
    </Stack>
  );
}

function IssueStatusSelect({ issue, onSaved }: { issue: IssueDetail; onSaved: () => void }) {
  const [status, setStatus] = useState(issue.status);
  useEffect(() => setStatus(issue.status), [issue.status]);

  async function save(next: IssueStatus) {
    const previous = status;
    setStatus(next);
    try {
      await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      toast({ title: `Status geändert: ${statusLabels[next]}` });
      onSaved();
    } catch (reason) {
      setStatus(previous);
      toast({ variant: 'destructive', title: 'Status nicht gespeichert', description: `${(reason as Error).message}. Bitte erneut versuchen.` });
    }
  }

  return (
    <Select value={status} onValueChange={(value) => save(value as IssueStatus)}>
      <SelectTrigger className="w-44" aria-label="Status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(statusLabels) as IssueStatus[]).map((option) => (
          <SelectItem key={option} value={option}>
            {statusLabels[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Saved when the field loses focus, so leaving the page never drops the text silently
function IssueNote({ issue }: { issue: IssueDetail }) {
  const [note, setNote] = useState(issue.note);
  const [saved, setSaved] = useState(issue.note);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  async function save() {
    if (note === saved) return;
    setState('saving');
    try {
      await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ note }) });
      setSaved(note);
      setState('idle');
    } catch (reason) {
      setState('error');
      toast({ variant: 'destructive', title: 'Notiz nicht gespeichert', description: `${(reason as Error).message}. Der Text bleibt im Feld, bitte erneut versuchen.` });
    }
  }

  const hint = state === 'saving' ? 'Wird gespeichert …' : state === 'error' ? 'Nicht gespeichert' : note !== saved ? 'Wird beim Verlassen des Felds gespeichert' : saved ? 'Gespeichert' : '';
  return (
    <Stack gap="block">
      <Label htmlFor="issue-note">Notiz, z. B. Ticket, Ursache oder Fix</Label>
      <Textarea id="issue-note" value={note} onChange={(event) => setNote(event.target.value)} onBlur={save} rows={2} />
      <div className="flex items-center gap-3">
        <span className="typography-small text-text-subtle" aria-live="polite">{hint}</span>
        {state === 'error' && (
          <Button variant="secondary" size="sm" onClick={save}>
            Erneut speichern
          </Button>
        )}
      </div>
    </Stack>
  );
}

function OccurrenceView({ occurrenceId, title, tab, onTabChange }: { occurrenceId: number; title: string; tab: Tab; onTabChange: (tab: Tab) => void }) {
  const occurrence = useResource(() => api<Occurrence>(`/api/occurrences/${occurrenceId}`), [occurrenceId]);
  if (occurrence.error) return <DataStatePanel kind="error" title="Vorkommen konnte nicht geladen werden" description={occurrence.error} onRetry={occurrence.reload} retryLabel="Erneut versuchen" />;
  if (!occurrence.data) return <TableLoading columns={4} rows={8} />;
  const data = occurrence.data;
  const missing = data.images.filter((image) => !image.symbols);
  const reference = referenceTime(data);
  const around = (seconds: number) => new Date(new Date(reference).getTime() + seconds * 1000).toISOString();
  const timelineLink = `/timeline?from=${encodeURIComponent(around(-60))}&to=${encodeURIComponent(around(60))}`;

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(occurrenceToMarkdown(title, data, window.location.href));
      toast({ title: 'Als Markdown kopiert', description: 'Kann direkt in ein Ticket eingefügt werden.' });
    } catch {
      toast({ variant: 'destructive', title: 'Kopieren nicht möglich', description: 'Der Browser hat den Zugriff auf die Zwischenablage verweigert.' });
    }
  }

  return (
    <Stack gap="section">
      <Stack gap="block">
        <PanelSectionHeader
          title="Kontext"
          titleAs="h2"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <RouterLink to={timelineLink}>In Timeline öffnen (±60 s)</RouterLink>
              </Button>
              <Button variant="outline" size="sm" onClick={copyMarkdown}>Als Markdown kopieren</Button>
            </div>
          }
        />
        <ContextAttributes occurrence={data} />
      </Stack>
      {missing.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>Eigene Frames nur teilweise lesbar</AlertTitle>
          <AlertDescription>
            Für {missing.map((image) => image.name).join(', ')} fehlen die dSYMs dieses Builds.{' '}
            <Link asChild underline="always" color="inherit">
              <RouterLink to={`/symbols?from=${encodeURIComponent(window.location.pathname + window.location.search)}`}>dSYMs hochladen</RouterLink>
            </Link>
            , danach erscheinen Funktion, Datei und Zeile.
          </AlertDescription>
        </Alert>
      )}
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as Tab)}>
        <TabsList>
          <TabsTrigger value="stack">Stacktrace</TabsTrigger>
          <TabsTrigger value="timeline">
            Timeline <TabsCount>{data.timeline.length}</TabsCount>
          </TabsTrigger>
          <TabsTrigger value="images">
            Binaries <TabsCount>{data.images.length}</TabsCount>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stack">
          <StackTraces stacks={data.stacks} />
        </TabsContent>
        <TabsContent value="timeline">
          <Timeline entries={data.timeline} occurrence={data} />
        </TabsContent>
        <TabsContent value="images">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Binary</TableHead>
                <TableHead className="hidden sm:table-cell">UUID</TableHead>
                <TableHead>Symbole</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.images.map((image) => (
                <TableRow key={image.uuid}>
                  <TableCell className="break-words">
                    {image.name}
                    <div className="font-mono text-text-subtle break-all sm:hidden">{image.uuid}</div>
                  </TableCell>
                  <TableCell className="hidden font-mono sm:table-cell">{image.uuid} <span className="text-text-subtle">{image.arch}</span></TableCell>
                  <TableCell>
                    <Badge variant={image.symbols ? 'success' : 'warning'} tinted>{image.symbols ? 'vorhanden' : 'fehlen'}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </Stack>
  );
}

function ContextAttributes({ occurrence }: { occurrence: Occurrence }) {
  const context = occurrence.context;
  const network = [context.network_type === 'wifi' ? 'WLAN' : context.network_type, typeof context.network_generation === 'string' ? context.network_generation.toUpperCase() : null]
    .filter(Boolean)
    .join(', ');
  return (
    <Attributes>
      <Attribute label={occurrence.window.exact ? 'Zeitpunkt' : 'Absturz'}><ContextValue>{crashTimeLabel(occurrence)}</ContextValue></Attribute>
      {!occurrence.window.exact && <Attribute label="Gespeichert beim Neustart"><ContextValue>{formatDateTime(occurrence.window.before)}</ContextValue></Attribute>}
      {occurrence.duration_ms ? <Attribute label="Dauer des Hängers"><ContextValue>{`${occurrence.duration_ms.toLocaleString('de-DE')} ms`}</ContextValue></Attribute> : null}
      <Attribute label="Prozess"><ContextValue>{processLabel(occurrence.process)}</ContextValue></Attribute>
      <Attribute label="App"><ContextValue>{`${context.app_version ?? '?'} (${context.app_build ?? '?'})`}</ContextValue></Attribute>
      <Attribute label="Gerät"><ContextValue>{`${context.device_model ?? '?'}, iOS ${context.os_version ?? '?'}`}</ContextValue></Attribute>
      <Attribute label="Netz"><ContextValue>{network || 'unbekannt'}</ContextValue></Attribute>
      <Attribute label="Energiesparmodus"><ContextValue>{context.device_low_power_mode ? 'an' : 'aus'}</ContextValue></Attribute>
      <Attribute label="Import"><ContextValue>{String(context.import ?? 'unbekannt')}</ContextValue></Attribute>
    </Attributes>
  );
}

// Values one step above the label size, so label and value read as a pair
function ContextValue({ children }: { children: ReactNode }) {
  return <span className="typography-p-ui text-foreground">{children}</span>;
}

type FrameRow = { frame: Frame; position: number } | { collapsed: Frame[]; binary: string; key: string };

// Runs of three or more system frames from the same binary are folded, they rarely matter for the cause
function foldSystemFrames(frames: Frame[]): FrameRow[] {
  const rows: FrameRow[] = [];
  let position = 0;
  while (position < frames.length) {
    const frame = frames[position];
    let end = position;
    while (!frame.in_app && !frame.library && end + 1 < frames.length && !frames[end + 1].in_app && !frames[end + 1].library && frames[end + 1].binary === frame.binary) end += 1;
    if (position > 0 && end - position >= 2) {
      rows.push({ collapsed: frames.slice(position, end + 1), binary: frame.binary ?? 'System', key: `run-${position}` });
    } else {
      for (let index = position; index <= end; index += 1) rows.push({ frame: frames[index], position: index });
    }
    position = end + 1;
  }
  return rows;
}

function FrameRowView({ frame, isCrashSite }: { frame: Frame; isCrashSite: boolean }) {
  const location = frameLocation(frame);
  const library = frame.library ? LIBRARY_NAMES[frame.library] ?? frame.library : null;
  return (
    <TableRow className={frame.in_app ? undefined : 'text-text-subtle'} data-state={isCrashSite ? 'selected' : undefined}>
      <TableCell className="hidden w-12 text-right tabular-nums sm:table-cell">{frame.index}</TableCell>
      <TableCell className="break-words">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono break-all">{frameLabel(frame)}</span>
          {isCrashSite && <Badge variant="destructive" tinted>Absturzstelle</Badge>}
          {frame.in_app && !frame.entry_point && <Badge variant="info" tinted>Eigener Code</Badge>}
          {frame.entry_point && <Badge variant="secondary" tinted>Einstieg</Badge>}
          {library && (
            <span title="Eingebundene Bibliothek, nicht euer Code. Measure zeichnet Gesten auf und taucht deshalb in vielen Stacks auf.">
              <Badge variant="outline">{library}</Badge>
            </span>
          )}
        </div>
        <div className="text-text-subtle sm:hidden">
          {frame.binary}
          {location ? `, ${location}` : ''}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">{frame.binary}</TableCell>
      <TableCell className="hidden font-mono whitespace-nowrap md:table-cell">{location ?? ''}</TableCell>
    </TableRow>
  );
}

function FramesTable({ stack, onlyOwn, crashed }: { stack: CrashStack; onlyOwn: boolean; crashed: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const frames = onlyOwn ? stack.frames.filter((frame) => frame.in_app || frame.library) : stack.frames;
  const rows = foldSystemFrames(frames);
  return (
    <Table density="compact">
      <TableHeader>
        <TableRow>
          <TableHead className="hidden w-12 text-right sm:table-cell">#</TableHead>
          <TableHead>Funktion</TableHead>
          <TableHead className="hidden sm:table-cell">Binary</TableHead>
          <TableHead className="hidden md:table-cell">Datei</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) =>
          'frame' in row ? (
            <FrameRowView key={`f-${row.position}`} frame={row.frame} isCrashSite={crashed && row.position === 0 && !onlyOwn} />
          ) : expanded.has(row.key) ? (
            <Fragment key={row.key}>
              {row.collapsed.map((frame, index) => <FrameRowView key={`${row.key}-${index}`} frame={frame} isCrashSite={false} />)}
            </Fragment>
          ) : (
            <TableRow key={row.key}>
              <TableCell className="hidden sm:table-cell" />
              <TableCell colSpan={3}>
                <Button variant="ghost" size="sm" onClick={() => setExpanded((current) => new Set(current).add(row.key))}>
                  {row.binary}: {row.collapsed.length} System-Frames einblenden
                </Button>
              </TableCell>
            </TableRow>
          ),
        )}
        {frames.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-text-subtle">Keine eigenen Frames in diesem Thread.</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function StackTraces({ stacks }: { stacks: CrashStack[] }) {
  const [onlyOwn, setOnlyOwn] = useState(false);
  const [crashed, ...others] = stacks;
  if (!crashed) return <DataStatePanel kind="empty" title="Kein Stacktrace im Event" />;
  const ownCount = (stack: CrashStack) => stack.frames.filter((frame) => frame.in_app && !frame.entry_point).length;
  const withOwnFrames = others.filter((stack) => ownCount(stack) > 0);
  const systemOnly = others.filter((stack) => ownCount(stack) === 0);
  return (
    <Stack gap="block">
      <PanelSectionHeader
        title={crashed.name}
        titleAs="h2"
        description={[crashed.reason, crashed.signal].filter(Boolean).join(', ') || undefined}
        actions={
          <div className="flex items-center gap-2">
            <Switch id="only-own" checked={onlyOwn} onCheckedChange={setOnlyOwn} />
            <Label htmlFor="only-own">Nur eigener Code und Bibliotheken</Label>
          </div>
        }
      />
      <p className="typography-small text-text-subtle">
        Systembibliotheken von iOS werden nicht aufgelöst, dafür fehlen die Symbole von Apple. Entscheidend sind die Absturzstelle und die eigenen Frames.
      </p>
      <FramesTable stack={crashed} onlyOwn={onlyOwn} crashed />
      {others.length > 0 && (
        <>
          <PanelSectionHeader title={`Weitere Threads (${others.length})`} titleAs="h2" />
          <Accordion type="multiple">
            {withOwnFrames.map((stack, index) => (
              <AccordionItem key={`own-${index}`} value={`own-${index}`}>
                <AccordionTrigger>
                  {stack.name}, {ownCount(stack)} eigene Frames
                </AccordionTrigger>
                <AccordionContent>
                  <FramesTable stack={stack} onlyOwn={onlyOwn} crashed={false} />
                </AccordionContent>
              </AccordionItem>
            ))}
            {systemOnly.length > 0 && (
              <AccordionItem value="system">
                <AccordionTrigger>{systemOnly.length} System-Threads ohne eigenen Code</AccordionTrigger>
                <AccordionContent>
                  <Stack gap="block">
                    {systemOnly.map((stack, index) => (
                      <Stack key={index} gap="block">
                        <span className="typography-small text-text-subtle">{stack.name}</span>
                        <FramesTable stack={stack} onlyOwn={onlyOwn} crashed={false} />
                      </Stack>
                    ))}
                  </Stack>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </>
      )}
    </Stack>
  );
}

const timelineFilters = {
  all: 'Alles',
  steps: 'Bedienschritte',
  logs: 'App-Logs',
  network: 'Netzwerk',
} as const;

function matchesFilter(entry: TimelineEntry, filter: keyof typeof timelineFilters): boolean {
  if (filter === 'logs') return entry.kind === 'app_log';
  if (filter === 'network') return entry.event_type === 'http';
  if (filter === 'steps') return Boolean(entry.event_type?.startsWith('gesture_') || entry.event_type?.startsWith('lifecycle_') || entry.event_type === 'screen_view');
  return true;
}

// Gaps without activity often mark a frozen main thread, also when no hang event was recorded
const GAP_SECONDS = 2;

type TimelineRow = { gap: number } | { restart: string } | { entry: TimelineEntry };

function buildRows(entries: TimelineEntry[], occurrence: Occurrence): TimelineRow[] {
  const rows: TimelineRow[] = [];
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    if (entry.id === occurrence.id && !occurrence.window.exact) {
      // The time between the last activity and the relaunch is the app being dead, not a hang
      rows.push({ restart: occurrence.window.before });
    } else if (previous) {
      const gap = (new Date(entry.ts).getTime() - new Date(previous.ts).getTime()) / 1000;
      if (gap >= GAP_SECONDS) rows.push({ gap });
    }
    rows.push({ entry });
  });
  return rows;
}

function Timeline({ entries, occurrence }: { entries: TimelineEntry[]; occurrence: Occurrence }) {
  const [filter, setFilter] = useState<keyof typeof timelineFilters>('all');
  const reference = referenceTime(occurrence);
  const rows = useMemo(
    () => buildRows(entries.filter((entry) => entry.id === occurrence.id || matchesFilter(entry, filter)), occurrence),
    [entries, filter, occurrence],
  );
  return (
    <Stack gap="block">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor="timeline-filter">Zeigen</Label>
        <Select value={filter} onValueChange={(value) => setFilter(value as keyof typeof timelineFilters)}>
          <SelectTrigger id="timeline-filter" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(timelineFilters).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table density="compact" stickyHeader maxHeight="70vh">
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 text-right">
              <span className="inline-flex items-center gap-1">
                Relativ
                <HelpIcon
                  label="Wie die Zeit gemessen wird"
                  content={
                    occurrence.window.exact
                      ? 'Sekunden relativ zum Hänger.'
                      : 'Ein Absturz wird erst beim nächsten Start gespeichert. Die Zeit zählt deshalb ab der letzten Aktivität davor.'
                  }
                />
              </span>
            </TableHead>
            <TableHead className="hidden w-32 sm:table-cell">Uhrzeit</TableHead>
            <TableHead className="hidden w-40 md:table-cell">Prozess</TableHead>
            <TableHead className="w-36">Typ</TableHead>
            <TableHead>Inhalt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, position) => {
            if ('gap' in row) {
              return (
                <TableRow key={`gap-${position}`}>
                  <TableCell colSpan={5} className="text-center text-text-subtle">
                    {row.gap.toLocaleString('de-DE', { maximumFractionDigits: 1 })} s keine Aktivität
                  </TableCell>
                </TableRow>
              );
            }
            if ('restart' in row) {
              return (
                <TableRow key={`restart-${position}`}>
                  <TableCell colSpan={5} className="text-center text-text-subtle">
                    App beendet, Neustart um {formatTime(row.restart)}
                  </TableCell>
                </TableRow>
              );
            }
            const { entry } = row;
            const isIssue = entry.id === occurrence.id;
            return (
              <TableRow key={entry.id} data-state={isIssue ? 'selected' : undefined} aria-current={isIssue ? 'true' : undefined}>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{isIssue && !occurrence.window.exact ? 'danach' : relativeSeconds(entry.ts, reference)}</TableCell>
                <TableCell className="hidden tabular-nums whitespace-nowrap sm:table-cell">{formatTime(entry.ts)}</TableCell>
                <TableCell className="hidden md:table-cell">{processLabel(entry.process)}</TableCell>
                <TableCell>
                  <EntryBadge entry={entry} />
                </TableCell>
                <TableCell className="break-words">
                  {entry.kind === 'app_log' && entry.category ? <span className="text-text-subtle">{entry.category}: </span> : null}
                  {entry.message}
                  <div className="text-text-subtle md:hidden">{processLabel(entry.process)}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Stack>
  );
}
