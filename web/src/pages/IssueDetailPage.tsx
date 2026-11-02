import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionBar,
  ActionBarRow,
  ActionBarSpacer,
  Attribute,
  Attributes,
  Badge,
  Button,
  DataStatePanel,
  HelpIcon,
  Input,
  KpiStrip,
  Link,
  MetricItem,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@getitdone-gmbh/kette-design-community';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { EntryBadge, KindBadge, StatusBadge, statusLabels } from '../components/IssueBadges';
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
import { fetchIssueList, germanError, issueHref } from '../lib/issueList';
import type { Frame, IssueDetail, IssueStatus, Occurrence, OccurrenceRef, Stack as CrashStack, TimelineEntry } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { useResource } from '../lib/useResource';

const TABS = ['stack', 'threads', 'timeline', 'occurrences', 'images'] as const;
type Tab = (typeof TABS)[number];

const LIBRARY_NAMES: Record<string, string> = { measure: 'Measure SDK', kscrash: 'KSCrash', kscrashrecording: 'KSCrash', swiftcbor: 'SwiftCBOR' };

// Titles read "<kind> in <place>": the place is the heading, the kind goes into the meta line
function splitTitle(title: string): { kind: string; place: string } {
  const at = title.indexOf(' in ');
  return at > 0 ? { kind: title.slice(0, at), place: title.slice(at + 4) } : { kind: '', place: title };
}

function useWideLayout(): boolean {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

const ownFrames = (stack: CrashStack) => stack.frames.filter((frame) => frame.in_app && !frame.entry_point);

export function IssueDetailPage() {
  const { issueId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const listQuery = params.get('from') ?? '';
  const listParams = useMemo(() => new URLSearchParams(listQuery), [listQuery]);
  const issue = useResource(() => api<IssueDetail>(`/api/issues/${issueId}`), [issueId]);
  const list = useResource(() => fetchIssueList(listParams), [listQuery]);
  const occurrenceId = Number(params.get('occurrence')) || issue.data?.occurrences[0]?.id || null;
  const occurrence = useResource(() => (occurrenceId ? api<Occurrence>(`/api/occurrences/${occurrenceId}`) : Promise.resolve(null)), [occurrenceId]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const wide = useWideLayout();
  usePageTitle(issue.data?.title ?? 'Issue');

  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'stack';
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const position = list.data?.findIndex((row) => String(row.id) === issueId) ?? -1;
  const previous = position > 0 ? list.data?.[position - 1] : undefined;
  const next = position >= 0 ? list.data?.[position + 1] : undefined;
  const breadcrumbs = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link asChild underline="hover" color="neutral">
        <RouterLink to={`/${listQuery ? `?${listQuery}` : ''}`}>Abstürze und Hänger</RouterLink>
      </Link>
      {position >= 0 && list.data && (
        <span className="inline-flex items-center gap-1 typography-small text-text-subtle">
          <Button variant="ghost" size="icon-xs" aria-label="Vorheriges Issue" disabled={!previous} onClick={() => previous && navigate(issueHref(previous.id, listQuery))}>
            ‹
          </Button>
          Issue {position + 1} von {list.data.length}
          <Button variant="ghost" size="icon-xs" aria-label="Nächstes Issue" disabled={!next} onClick={() => next && navigate(issueHref(next.id, listQuery))}>
            ›
          </Button>
        </span>
      )}
    </div>
  );

  if (issue.error) {
    const notFound = /not found/i.test(issue.error);
    return (
      <Stack gap="section">
        <PageHeader variant="record" title={notFound ? 'Issue nicht gefunden' : 'Issue konnte nicht geladen werden'} titleAs="h1" breadcrumbs={breadcrumbs} />
        <DataStatePanel
          kind={notFound ? 'empty' : 'error'}
          title={notFound ? 'Dieses Issue gibt es nicht mehr' : 'Laden fehlgeschlagen'}
          description={notFound ? 'Das Issue wurde gelöscht, zum Beispiel mit seinem Import, oder die Adresse ist falsch.' : germanError(issue.error)}
          onRetry={notFound ? undefined : issue.reload}
          retryLabel="Erneut versuchen"
        />
      </Stack>
    );
  }

  if (!issue.data) {
    return (
      <Stack gap="section" aria-busy="true">
        <PageHeader variant="record" title={<Skeleton variant="text" className="h-8 w-80 max-w-full" label="Issue wird geladen" />} titleAs="h1" breadcrumbs={breadcrumbs} />
        <Skeleton variant="block" className="h-20" />
        <Skeleton variant="row" rows={8} />
      </Stack>
    );
  }

  const data = issue.data;
  const current = occurrence.data;
  const crashed = current?.stacks[0];
  const others = current?.stacks.slice(1) ?? [];
  const missing = current?.images.filter((image) => !image.symbols) ?? [];
  const selectedRef = data.occurrences.find((row) => row.id === occurrenceId) ?? data.occurrences[0];
  const { kind, place } = splitTitle(data.title);

  return (
    <Tabs value={tab} onValueChange={(value) => setParam('tab', value === 'stack' ? null : value)}>
      <Stack gap="section">
        <PageHeader
          variant="record"
          titleAs="h1"
          title={<span className="[overflow-wrap:anywhere]">{place}</span>}
          breadcrumbs={breadcrumbs}
          badges={
            <>
              <KindBadge kind={data.kind} />
              <StatusBadge status={data.status} />
            </>
          }
          subtitle={<span className="[overflow-wrap:anywhere]">{subtitleFor(kind, current, selectedRef)}</span>}
          actions={
            <>
              <IssueStatusSelect issue={data} onSaved={issue.reload} />
              {current && (
                <Button variant="outline" asChild>
                  <RouterLink to={timelineLink(current)}>In Timeline öffnen</RouterLink>
                </Button>
              )}
              {!wide && (
                <Button variant="outline" onClick={() => setDetailsOpen(true)}>
                  Details
                </Button>
              )}
            </>
          }
          primaryAction={current ? <CopyMarkdownButton title={data.title} occurrence={current} /> : undefined}
          tabs={
            <TabsList className="max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="stack">
                Stacktrace <TabsCount>{crashed?.frames.length ?? 0}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="threads">
                Threads <TabsCount>{others.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="timeline">
                Timeline <TabsCount>{current?.timeline.length ?? 0}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="occurrences">
                Vorkommen <TabsCount>{data.occurrences.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="images">
                Binaries <TabsCount>{current?.images.length ?? 0}</TabsCount>
              </TabsTrigger>
            </TabsList>
          }
        />

        <div className="hidden md:block">
          <IssueKpis issue={data} crashed={crashed} missing={missing.length} />
        </div>

        <div className="grid gap-grid-gutter xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-8">
            {occurrence.error ? (
              <DataStatePanel kind="error" title="Vorkommen konnte nicht geladen werden" description={germanError(occurrence.error)} onRetry={occurrence.reload} retryLabel="Erneut versuchen" />
            ) : !current ? (
              <Stack gap="block" aria-busy="true">
                <Skeleton variant="row-single" />
                <Skeleton variant="row" rows={10} />
              </Stack>
            ) : (
              <>
                <TabsContent value="stack">
                  {crashed ? <StackTab stack={crashed} /> : <DataStatePanel kind="empty" title="Kein Stacktrace im Event" />}
                </TabsContent>
                <TabsContent value="threads">
                  <ThreadsTab stacks={others} />
                </TabsContent>
                <TabsContent value="timeline">
                  <TimelineTab entries={current.timeline} occurrence={current} />
                </TabsContent>
                <TabsContent value="occurrences">
                  <OccurrencesTab rows={data.occurrences} selected={selectedRef?.id ?? null} onSelect={(id) => setParam('occurrence', String(id))} />
                </TabsContent>
                <TabsContent value="images">
                  <ImagesTab images={current.images} />
                </TabsContent>
              </>
            )}
          </div>
          {wide && (
            <aside className="min-w-0 xl:col-span-4">
              <ContextAttributes issue={data} occurrence={current} selected={selectedRef} onSelect={(id) => setParam('occurrence', String(id))} onNoteSaved={issue.reload} />
            </aside>
          )}
        </div>

        <Sheet open={detailsOpen && !wide} onOpenChange={setDetailsOpen}>
          <SheetContent side="right" size="sm">
            <SheetHeader>
              <SheetTitle>Details</SheetTitle>
            </SheetHeader>
            <div className="px-6 pb-6">
              <ContextAttributes issue={data} occurrence={current} selected={selectedRef} onSelect={(id) => setParam('occurrence', String(id))} onNoteSaved={issue.reload} />
            </div>
          </SheetContent>
        </Sheet>
      </Stack>
    </Tabs>
  );
}

function subtitleFor(kind: string, occurrence: Occurrence | null, ref: OccurrenceRef | undefined): string {
  if (!ref) return '';
  const reason = (occurrence?.stacks[0]?.reason ?? '').replace(/^\*+\s*/, '');
  const hang = occurrence?.duration_ms ? `${occurrence.duration_ms.toLocaleString('de-DE')} ms blockiert` : '';
  return [[kind, reason || hang].filter(Boolean).join(': '), processLabel(ref.process), `${ref.app_version} (${ref.app_build})`, `${ref.device_model}, iOS ${ref.os_version}`, formatDateTime(ref.ts)]
    .filter(Boolean)
    .join(' · ');
}

function timelineLink(occurrence: Occurrence): string {
  const reference = referenceTime(occurrence);
  const around = (seconds: number) => new Date(new Date(reference).getTime() + seconds * 1000).toISOString();
  return `/timeline?from=${encodeURIComponent(around(-60))}&to=${encodeURIComponent(around(60))}`;
}

function CopyMarkdownButton({ title, occurrence }: { title: string; occurrence: Occurrence }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(occurrenceToMarkdown(title, occurrence, window.location.href));
      toast({ title: 'Als Markdown kopiert', description: 'Kann direkt in ein Ticket eingefügt werden.' });
    } catch {
      toast({ variant: 'destructive', title: 'Kopieren nicht möglich', description: 'Der Browser hat den Zugriff auf die Zwischenablage verweigert.' });
    }
  }
  return <Button onClick={copy}>Als Markdown kopieren</Button>;
}

function IssueStatusSelect({ issue, onSaved }: { issue: IssueDetail; onSaved: () => void }) {
  const [status, setStatus] = useState(issue.status);

  async function apply(next: IssueStatus, previous: IssueStatus, undo: boolean) {
    setStatus(next);
    try {
      await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      onSaved();
      if (undo) return;
      const leavesList = next === 'resolved' || next === 'ignored';
      toast({
        title: `Status: ${statusLabels[next]}`,
        description: leavesList ? 'Erscheint nicht mehr unter „Offen und in Analyse“.' : undefined,
        action: (
          <Button variant="outline" size="sm" onClick={() => apply(previous, next, true)}>
            Rückgängig
          </Button>
        ) as never,
      });
    } catch (reason) {
      setStatus(previous);
      toast({ variant: 'destructive', title: 'Status nicht gespeichert', description: `${germanError((reason as Error).message)} Bitte erneut versuchen.` });
    }
  }

  return (
    <Select value={status} onValueChange={(value) => apply(value as IssueStatus, status, false)}>
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

// Hidden on phones: version and time are in the subtitle, so the crash site stays in the first screen
function IssueKpis({ issue, crashed, missing }: { issue: IssueDetail; crashed: CrashStack | undefined; missing: number }) {
  const times = issue.occurrences.map((row) => row.ts).sort();
  const versions = [...new Set(issue.occurrences.map((row) => `${row.app_version} (${row.app_build})`))];
  return (
    <KpiStrip>
      <MetricItem variant="strip" label="Vorkommen" value={issue.occurrences.length} />
      <MetricItem variant="strip" label="Zuletzt gesehen" value={formatDateTime(times[times.length - 1])} caption={times.length > 1 ? `zuerst ${formatDateTime(times[0])}` : undefined} />
      <MetricItem variant="strip" label={versions.length === 1 ? 'Version' : 'Versionen'} value={versions.join(', ')} />
      <MetricItem variant="strip" label="Eigene Frames" value={crashed ? ownFrames(crashed).length : '–'} />
      <MetricItem
        variant="strip"
        label="Fehlende dSYMs"
        value={missing}
        caption={
          missing > 0 ? (
            <Link asChild underline="always" color="inherit">
              <RouterLink to={`/symbols?from=${encodeURIComponent(window.location.pathname + window.location.search)}`}>hochladen</RouterLink>
            </Link>
          ) : undefined
        }
      />
    </KpiStrip>
  );
}

function ContextAttributes({
  issue,
  occurrence,
  selected,
  onSelect,
  onNoteSaved,
}: {
  issue: IssueDetail;
  occurrence: Occurrence | null;
  selected: OccurrenceRef | undefined;
  onSelect: (id: number) => void;
  onNoteSaved: () => void;
}) {
  const index = issue.occurrences.findIndex((row) => row.id === selected?.id);
  const context = occurrence?.context ?? {};
  const network = [context.network_type === 'wifi' ? 'WLAN' : context.network_type, typeof context.network_generation === 'string' ? context.network_generation.toUpperCase() : null]
    .filter(Boolean)
    .join(', ');

  async function saveNote(note: string) {
    if (note === issue.note) return;
    try {
      await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ note }) });
      toast({ title: note ? 'Notiz gespeichert' : 'Notiz entfernt' });
      onNoteSaved();
    } catch (reason) {
      toast({ variant: 'destructive', title: 'Notiz nicht gespeichert', description: `${germanError((reason as Error).message)} Bitte erneut versuchen.` });
    }
  }

  return (
    <Attributes variant="aside" title="Kontext" titleAs="h2" state={occurrence ? 'ready' : 'loading'}>
      {issue.occurrences.length > 1 && (
        <Attribute label="Vorkommen">
          <span className="inline-flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" aria-label="Vorheriges Vorkommen" disabled={index <= 0} onClick={() => onSelect(issue.occurrences[index - 1].id)}>
              ‹
            </Button>
            {index + 1} von {issue.occurrences.length}
            <Button variant="ghost" size="icon-xs" aria-label="Nächstes Vorkommen" disabled={index >= issue.occurrences.length - 1} onClick={() => onSelect(issue.occurrences[index + 1].id)}>
              ›
            </Button>
          </span>
        </Attribute>
      )}
      {occurrence && <Attribute label={occurrence.window.exact ? 'Zeitpunkt' : 'Absturz'} value={crashTimeLabel(occurrence)} />}
      {occurrence && !occurrence.window.exact && <Attribute label="Gespeichert beim Neustart" value={formatDateTime(occurrence.window.before)} />}
      {occurrence?.duration_ms ? <Attribute label="Dauer des Hängers" value={`${occurrence.duration_ms.toLocaleString('de-DE')} ms`} /> : null}
      <Attribute label="Prozess" value={selected ? processLabel(selected.process) : ''} />
      <Attribute label="App" value={`${context.app_version ?? selected?.app_version ?? '?'} (${context.app_build ?? selected?.app_build ?? '?'})`} />
      <Attribute label="Gerät" value={`${context.device_model ?? selected?.device_model ?? '?'}, iOS ${context.os_version ?? selected?.os_version ?? '?'}`} />
      <Attribute label="Netz" value={network || 'unbekannt'} />
      <Attribute label="Energiesparmodus" value={context.device_low_power_mode ? 'an' : 'aus'} />
      <Attribute label="Import">
        {selected ? (
          <Link asChild underline="hover">
            <RouterLink to={`/imports#import-${selected.import_id}`} className="[overflow-wrap:anywhere]">
              {String(context.import ?? selected.filename ?? 'Import')}
            </RouterLink>
          </Link>
        ) : null}
      </Attribute>
      <Attribute label="Notiz">
        <NoteField key={issue.note} note={issue.note} onCommit={saveNote} />
      </Attribute>
    </Attributes>
  );
}

// Saves on Enter or when leaving the field, Escape restores the saved text
function NoteField({ note, onCommit }: { note: string; onCommit: (note: string) => void }) {
  const [draft, setDraft] = useState(note);
  return (
    <Input
      value={draft}
      placeholder="Ticket, Ursache oder Fix"
      aria-label="Notiz, z. B. Ticket, Ursache oder Fix"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(note);
      }}
    />
  );
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
    <TableRow
      className={[frame.in_app ? '' : 'text-text-subtle', isCrashSite ? 'bg-table-background-selected' : ''].join(' ').trim() || undefined}
      data-state={isCrashSite ? 'selected' : undefined}
      aria-current={isCrashSite ? 'true' : undefined}
    >
      <TableCell className="hidden w-12 text-right tabular-nums sm:table-cell">{frame.index}</TableCell>
      <TableCell className="break-words">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono break-all">{frameLabel(frame)}</span>
          {isCrashSite && <Badge variant="destructive" tinted>Absturzstelle</Badge>}
          {frame.in_app && !frame.entry_point && <Badge variant="info" tinted>Eigener Code</Badge>}
          {frame.entry_point && <Badge variant="secondary" tinted>Einstieg</Badge>}
          {library && <Badge variant="outline">{library}</Badge>}
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
          <TableHead>
            <span className="inline-flex items-center gap-1">
              Funktion
              <HelpIcon label="Warum System-Frames nur Adressen zeigen" content="Systembibliotheken von iOS werden nicht aufgelöst, dafür fehlen die Symbole von Apple. Entscheidend sind die Absturzstelle und die eigenen Frames." />
            </span>
          </TableHead>
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
            <TableRow key={row.key} className="text-text-subtle">
              <TableCell className="hidden sm:table-cell" />
              <TableCell colSpan={3}>
                <Button variant="link" size="inline" onClick={() => setExpanded((current) => new Set(current).add(row.key))}>
                  {row.collapsed.length} System-Frames ({row.binary}) einblenden
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

function FrameScope({ stack, value, onChange }: { stack: CrashStack; value: 'all' | 'own'; onChange: (value: 'all' | 'own') => void }) {
  return (
    <ToggleGroup type="single" variant="segmented" value={value} onValueChange={(next) => next && onChange(next as 'all' | 'own')} aria-label="Frames">
      <ToggleGroupItem value="all">Alle Frames {stack.frames.length}</ToggleGroupItem>
      <ToggleGroupItem value="own">Eigener Code {stack.frames.filter((frame) => frame.in_app || frame.library).length}</ToggleGroupItem>
    </ToggleGroup>
  );
}

function StackTab({ stack }: { stack: CrashStack }) {
  const [scope, setScope] = useState<'all' | 'own'>('all');
  return (
    <Stack gap="block">
      <ActionBar>
        <ActionBarRow>
          <FrameScope stack={stack} value={scope} onChange={setScope} />
          <ActionBarSpacer />
          {stack.signal && <span className="typography-small text-text-subtle">{stack.name}, {stack.signal}</span>}
        </ActionBarRow>
      </ActionBar>
      <FramesTable stack={stack} onlyOwn={scope === 'own'} crashed />
    </Stack>
  );
}

function ThreadsTab({ stacks }: { stacks: CrashStack[] }) {
  if (stacks.length === 0) return <DataStatePanel kind="empty" title="Keine weiteren Threads im Event" />;
  const sorted = [...stacks].sort((a, b) => ownFrames(b).length - ownFrames(a).length);
  return (
    <Accordion type="multiple">
      {sorted.map((stack, index) => (
        <AccordionItem key={index} value={String(index)}>
          <AccordionTrigger>
            {stack.name} · {ownFrames(stack).length > 0 ? `${ownFrames(stack).length} eigene Frames` : 'nur System'}
          </AccordionTrigger>
          <AccordionContent>
            <FramesTable stack={stack} onlyOwn={false} crashed={false} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

const timelineFilters = {
  all: 'Alles',
  steps: 'Bedienschritte',
  logs: 'App-Logs',
  network: 'Netzwerk',
} as const;
type TimelineFilter = keyof typeof timelineFilters;

function matchesFilter(entry: TimelineEntry, filter: TimelineFilter): boolean {
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

function TimelineTab({ entries, occurrence }: { entries: TimelineEntry[]; occurrence: Occurrence }) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const reference = referenceTime(occurrence);
  const counts = useMemo(
    () => Object.fromEntries((Object.keys(timelineFilters) as TimelineFilter[]).map((key) => [key, entries.filter((entry) => matchesFilter(entry, key)).length])) as Record<TimelineFilter, number>,
    [entries],
  );
  const rows = useMemo(
    () => buildRows(entries.filter((entry) => entry.id === occurrence.id || matchesFilter(entry, filter)), occurrence),
    [entries, filter, occurrence],
  );
  return (
    <Stack gap="block">
      <ActionBar>
        <ActionBarRow>
          <ToggleGroup type="single" variant="segmented" value={filter} onValueChange={(next) => next && setFilter(next as TimelineFilter)} aria-label="Einträge filtern">
            {(Object.keys(timelineFilters) as TimelineFilter[]).map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {timelineFilters[key]} {counts[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ActionBarRow>
      </ActionBar>
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
              <TableRow key={entry.id} className={isIssue ? 'bg-table-background-selected' : undefined} data-state={isIssue ? 'selected' : undefined} aria-current={isIssue ? 'true' : undefined}>
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

function OccurrencesTab({ rows, selected, onSelect }: { rows: OccurrenceRef[]; selected: number | null; onSelect: (id: number) => void }) {
  return (
    <Table density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Zeit</TableHead>
          <TableHead className="hidden sm:table-cell">Version</TableHead>
          <TableHead className="hidden md:table-cell">Gerät</TableHead>
          <TableHead>Prozess</TableHead>
          <TableHead className="hidden lg:table-cell">Import</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isSelected = row.id === selected;
          return (
            <TableRow
              key={row.id}
              className={isSelected ? 'bg-table-background-selected' : 'cursor-pointer'}
              data-state={isSelected ? 'selected' : undefined}
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => onSelect(row.id)}
            >
              <TableCell className="whitespace-nowrap">
                <Button variant="link" size="inline" onClick={(event) => { event.stopPropagation(); onSelect(row.id); }}>
                  {formatDateTime(row.ts)}
                </Button>
              </TableCell>
              <TableCell className="hidden sm:table-cell">{row.app_version} ({row.app_build})</TableCell>
              <TableCell className="hidden md:table-cell">{row.device_model}, iOS {row.os_version}</TableCell>
              <TableCell>{processLabel(row.process)}</TableCell>
              <TableCell className="hidden break-all lg:table-cell">{row.filename ?? ''}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ImagesTab({ images }: { images: Occurrence['images'] }) {
  return (
    <Table density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Binary</TableHead>
          <TableHead className="hidden sm:table-cell">UUID</TableHead>
          <TableHead>Symbole</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {images.map((image) => (
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
  );
}

