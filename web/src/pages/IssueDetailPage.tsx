import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionBar,
  ActionBarRow,
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
  SheetBody,
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
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { EntryBadge, KindBadge, statusLabels } from '../components/IssueBadges';
import { api } from '../lib/api';
import {
  crashTimeLabel,
  formatDateTime,
  formatTime,
  frameLabel,
  frameLocation,
  occurrenceToMarkdown,
  plural,
  processLabel,
  referenceTime,
  relativeSeconds,
} from '../lib/format';
import { fetchIssueList, readableError, issueHref } from '../lib/issueList';
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

// Long Swift names may wrap after a dot or before the argument list, never inside a word
function breakable(text: string) {
  return text.split(/(?<=\.)|(?=\()/).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ));
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

// Ends stay focusable instead of disabled, so focus never falls back to the page
function Pager({ label, previous, next, onPrevious, onNext, children }: { label: string; previous: boolean; next: boolean; onPrevious: () => void; onNext: () => void; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 typography-small text-text-subtle">
      <Button variant="ghost" size="icon-xs" aria-label={`Previous ${label}`} aria-disabled={!previous} className={previous ? undefined : 'opacity-40'} onClick={() => previous && onPrevious()}>
        <ChevronLeft aria-hidden />
      </Button>
      {children}
      <Button variant="ghost" size="icon-xs" aria-label={`Next ${label}`} aria-disabled={!next} className={next ? undefined : 'opacity-40'} onClick={() => next && onNext()}>
        <ChevronRight aria-hidden />
      </Button>
    </span>
  );
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
        <RouterLink to={`/${listQuery ? `?${listQuery}` : ''}`}>Issues</RouterLink>
      </Link>
      {position >= 0 && list.data && (
        <Pager label="issue" previous={Boolean(previous)} next={Boolean(next)} onPrevious={() => previous && navigate(issueHref(previous.id, listQuery))} onNext={() => next && navigate(issueHref(next.id, listQuery))}>
          Issue {position + 1} of {list.data.length}
        </Pager>
      )}
    </div>
  );

  if (issue.error) {
    const notFound = /not found/i.test(issue.error);
    return (
      <Stack gap="section">
        <PageHeader variant="record" title={notFound ? 'Issue not found' : 'Issue could not be loaded'} titleAs="h1" breadcrumbs={breadcrumbs} />
        <DataStatePanel
          kind={notFound ? 'empty' : 'error'}
          title={notFound ? 'This issue no longer exists' : 'Loading failed'}
          description={notFound ? 'The issue was deleted, for example together with its import, or the address is wrong.' : readableError(issue.error)}
          onRetry={notFound ? undefined : issue.reload}
          retryLabel="Try again"
        />
      </Stack>
    );
  }

  if (!issue.data) {
    return (
      <Stack gap="section" aria-busy="true">
        <PageHeader variant="record" title={<Skeleton variant="text" className="h-8 w-80 max-w-full" label="Loading issue" />} titleAs="h1" breadcrumbs={breadcrumbs} />
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
          title={<span className="break-words">{breakable(place)}</span>}
          breadcrumbs={breadcrumbs}
          badges={<KindBadge kind={data.kind} />}
          subtitle={<span className="[overflow-wrap:anywhere]">{subtitleFor(kind, current, selectedRef)}</span>}
          actions={
            <>
              <IssueStatusSelect issue={data} onSaved={issue.reload} />
              {current && (
                <Button variant="outline" asChild>
                  <RouterLink to={timelineLink(current)}>Show in Entries (±60 s)</RouterLink>
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
            <TabsList className="max-w-full justify-start overflow-x-auto max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
              <TabsTrigger value="stack">
                Stack trace {current && <TabsCount>{crashed?.frames.length ?? 0}</TabsCount>}
              </TabsTrigger>
              <TabsTrigger value="threads">
                Threads {current && <TabsCount>{others.length}</TabsCount>}
              </TabsTrigger>
              <TabsTrigger value="timeline">
                Entries {current && <TabsCount>{current.timeline.length}</TabsCount>}
              </TabsTrigger>
              <TabsTrigger value="occurrences">
                Occurrences <TabsCount>{data.occurrences.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="images">
                Binaries {current && <TabsCount>{current.images.length}</TabsCount>}
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
              <DataStatePanel kind="error" title="Occurrence could not be loaded" description={readableError(occurrence.error)} onRetry={occurrence.reload} retryLabel="Try again" />
            ) : !current ? (
              <Stack gap="block" aria-busy="true">
                <Skeleton variant="row-single" />
                <Skeleton variant="row" rows={10} />
              </Stack>
            ) : (
              <>
                <TabsContent value="stack">
                  {crashed ? <StackTab stack={crashed} hang={data.kind === 'hang'} /> : <DataStatePanel kind="empty" title="No stack trace in the event" />}
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
              <ContextAttributes issue={data} occurrence={current} error={occurrence.error} onRetry={occurrence.reload} selected={selectedRef} onSelect={(id) => setParam('occurrence', String(id))} onNoteSaved={issue.reload} />
            </aside>
          )}
        </div>

        <Sheet open={detailsOpen && !wide} onOpenChange={setDetailsOpen}>
          <SheetContent
            side="right"
            size="sm"
            onOpenAutoFocus={(event) => {
              // Focus the title instead of the note field, so phones keep the keyboard closed and screen readers announce the sheet
              event.preventDefault();
              document.getElementById('details-title')?.focus();
            }}
          >
            <SheetHeader>
              <SheetTitle id="details-title" tabIndex={-1}>
                Details
              </SheetTitle>
            </SheetHeader>
            <SheetBody>
              <Stack gap="block">
                <IssueKpis issue={data} crashed={crashed} missing={missing.length} />
                <ContextAttributes issue={data} occurrence={current} error={occurrence.error} onRetry={occurrence.reload} selected={selectedRef} onSelect={(id) => setParam('occurrence', String(id))} onNoteSaved={issue.reload} untitled />
              </Stack>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </Stack>
    </Tabs>
  );
}

function subtitleFor(kind: string, occurrence: Occurrence | null, ref: OccurrenceRef | undefined): string {
  if (!ref) return '';
  const stack = occurrence?.stacks[0];
  const reason = [(stack?.reason ?? '').replace(/^\*+\s*/, ''), stack?.signal].filter(Boolean).join(', ');
  const hang = occurrence?.duration_ms ? `${occurrence.duration_ms.toLocaleString('en-GB')} ms blocked` : '';
  return [[kind, reason || hang].filter(Boolean).join(': '), processLabel(ref.process), `${ref.app_version} (${ref.app_build})`, `${ref.device_model}, iOS ${ref.os_version}`, formatDateTime(ref.ts)]
    .filter(Boolean)
    .join(' · ');
}

function timelineLink(occurrence: Occurrence): string {
  const reference = referenceTime(occurrence);
  const around = (seconds: number) => new Date(new Date(reference).getTime() + seconds * 1000).toISOString();
  return `/timeline?from=${encodeURIComponent(around(-60))}&to=${encodeURIComponent(around(60))}&entry=${occurrence.id}`;
}

function CopyMarkdownButton({ title, occurrence }: { title: string; occurrence: Occurrence }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(occurrenceToMarkdown(title, occurrence, window.location.href));
      toast({ title: 'Copied as Markdown', description: 'Ready to paste into a ticket.' });
    } catch {
      toast({ variant: 'destructive', title: 'Copy not possible', description: 'The browser denied access to the clipboard.' });
    }
  }
  return <Button onClick={copy}>Copy as Markdown</Button>;
}

function IssueStatusSelect({ issue, onSaved }: { issue: IssueDetail; onSaved: () => void }) {
  const [status, setStatus] = useState(issue.status);

  async function apply(next: IssueStatus, previous: IssueStatus, undo: boolean) {
    setStatus(next);
    try {
      await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      onSaved();
      if (undo) {
        toast({ title: `Status restored: ${statusLabels[next]}` });
        return;
      }
      const leavesList = next === 'resolved' || next === 'ignored';
      const shown = toast({
        title: `Status: ${statusLabels[next]}`,
        description: leavesList ? 'No longer shown under “Open and investigating”.' : undefined,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              shown.dismiss();
              apply(previous, next, true);
            }}
          >
            Undo
          </Button>
        ) as never,
      });
    } catch (reason) {
      setStatus(previous);
      toast({ variant: 'destructive', title: 'Status not saved', description: `${readableError((reason as Error).message)} Please try again.` });
    }
  }

  return (
    <Select value={status} onValueChange={(value) => apply(value as IssueStatus, status, false)}>
      <SelectTrigger size="md" className="w-44" aria-label="Status">
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
      <MetricItem variant="strip" label="Occurrences" value={issue.occurrences.length} />
      <MetricItem variant="strip" label="Last seen" value={formatDateTime(times[times.length - 1])} caption={times.length > 1 ? `first ${formatDateTime(times[0])}` : undefined} />
      <MetricItem variant="strip" label={versions.length === 1 ? 'Version' : 'Versions'} value={versions.join(', ')} />
      <MetricItem variant="strip" label="Own frames" value={crashed ? ownFrames(crashed).length : '–'} />
      <MetricItem
        variant="strip"
        label="Missing dSYMs"
        value={missing}
        caption={
          missing > 0 ? (
            <Link asChild underline="always" color="inherit">
              <RouterLink to={`/symbols?from=${encodeURIComponent(window.location.pathname + window.location.search)}`}>upload</RouterLink>
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
  error,
  onRetry,
  selected,
  onSelect,
  onNoteSaved,
  untitled,
}: {
  issue: IssueDetail;
  occurrence: Occurrence | null;
  error: string | null;
  onRetry: () => void;
  untitled?: boolean;
  selected: OccurrenceRef | undefined;
  onSelect: (id: number) => void;
  onNoteSaved: () => void;
}) {
  const index = issue.occurrences.findIndex((row) => row.id === selected?.id);
  const context = occurrence?.context ?? {};
  const network = [context.network_type === 'wifi' ? 'Wi-Fi' : context.network_type, typeof context.network_generation === 'string' ? context.network_generation.toUpperCase() : null]
    .filter(Boolean)
    .join(', ');

  async function saveNote(note: string) {
    if (note === issue.note) return;
    try {
      await api(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ note }) });
      toast({ title: note ? 'Note saved' : 'Note removed' });
      onNoteSaved();
    } catch (reason) {
      toast({ variant: 'destructive', title: 'Note not saved', description: `${readableError((reason as Error).message)} Please try again.` });
    }
  }

  return (
    <Attributes
      variant="aside"
      title={untitled ? undefined : 'Context'}
      titleAs="h2"
      state={error ? 'error' : occurrence ? 'ready' : 'loading'}
      errorState={
        <Stack gap="block">
          <span>{error ? readableError(error) : ''}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </Stack>
      }
    >
      {issue.occurrences.length > 1 && (
        <Attribute label="Occurrence">
          <Pager label="occurrence" previous={index > 0} next={index < issue.occurrences.length - 1} onPrevious={() => onSelect(issue.occurrences[index - 1].id)} onNext={() => onSelect(issue.occurrences[index + 1].id)}>
            {index + 1} of {issue.occurrences.length}
          </Pager>
        </Attribute>
      )}
      {occurrence && <Attribute label={occurrence.window.exact ? 'Time' : 'Crash'} value={crashTimeLabel(occurrence)} />}
      {occurrence && !occurrence.window.exact && <Attribute label="Stored on relaunch" value={formatDateTime(occurrence.window.before)} />}
      {occurrence?.duration_ms ? <Attribute label="Hang duration" value={`${occurrence.duration_ms.toLocaleString('en-GB')} ms`} /> : null}
      <Attribute label="Process" value={selected ? processLabel(selected.process) : ''} />
      <Attribute label="App" value={`${context.app_version ?? selected?.app_version ?? '?'} (${context.app_build ?? selected?.app_build ?? '?'})`} />
      <Attribute label="Device" value={`${context.device_model ?? selected?.device_model ?? '?'}, iOS ${context.os_version ?? selected?.os_version ?? '?'}`} />
      <Attribute label="Network" value={network || 'unknown'} />
      <Attribute label="Low Power Mode" value={context.device_low_power_mode ? 'on' : 'off'} />
      <Attribute label="Import">
        {selected ? (
          <Link asChild underline="hover">
            <RouterLink to={`/imports#import-${selected.import_id}`} className="[overflow-wrap:anywhere]">
              {String(context.import ?? selected.filename ?? 'Import')}
            </RouterLink>
          </Link>
        ) : null}
      </Attribute>
      <Attribute label="Note">
        <NoteField note={issue.note} onCommit={saveNote} />
      </Attribute>
    </Attributes>
  );
}

// Saves on Enter or when leaving the field and keeps focus there; Escape restores the saved text
function NoteField({ note, onCommit }: { note: string; onCommit: (note: string) => void }) {
  const [draft, setDraft] = useState(note);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== field.current) setDraft(note);
  }, [note]);
  return (
    <Input
      ref={field}
      value={draft}
      placeholder="Ticket or cause"
      aria-label="Note, e.g. ticket, cause or fix"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft.trim());
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

function FrameRowView({ frame, isCrashSite, hang }: { frame: Frame; isCrashSite: boolean; hang?: boolean }) {
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
          <span className="font-mono break-words">{breakable(frameLabel(frame))}</span>
          {isCrashSite && <Badge variant={hang ? 'warning' : 'destructive'} tinted>{hang ? 'Hangs here' : 'Crash site'}</Badge>}
          {frame.in_app && !frame.entry_point && <Badge variant="info" tinted>Own code</Badge>}
          {frame.entry_point && <Badge variant="secondary" tinted>Entry point</Badge>}
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

function FramesTable({ stack, onlyOwn, crashed, hang }: { stack: CrashStack; onlyOwn: boolean; crashed: boolean; hang?: boolean }) {
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
              Function
              <HelpIcon label="Why system frames show only addresses" content="iOS system libraries are not resolved because Apple's symbols are not available. What matters are the crash site and your own frames." />
            </span>
          </TableHead>
          <TableHead className="hidden sm:table-cell">Binary</TableHead>
          <TableHead className="hidden md:table-cell">File</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) =>
          'frame' in row ? (
            <FrameRowView key={`f-${row.position}`} frame={row.frame} isCrashSite={crashed && row.position === 0 && !onlyOwn} hang={hang} />
          ) : expanded.has(row.key) ? (
            <Fragment key={row.key}>
              {row.collapsed.map((frame, index) => <FrameRowView key={`${row.key}-${index}`} frame={frame} isCrashSite={false} />)}
            </Fragment>
          ) : (
            <TableRow key={row.key} className="text-text-subtle">
              <TableCell className="hidden sm:table-cell" />
              <TableCell colSpan={3}>
                <Button variant="link" size="inline" onClick={() => setExpanded((current) => new Set(current).add(row.key))}>
                  Show {plural(row.collapsed.length, 'system frame')} ({row.binary})
                </Button>
              </TableCell>
            </TableRow>
          ),
        )}
        {frames.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-text-subtle">No own frames in this thread.</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function FrameScope({ stack, value, onChange }: { stack: CrashStack; value: 'all' | 'own'; onChange: (value: 'all' | 'own') => void }) {
  return (
    <ToggleGroup type="single" variant="segmented" value={value} onValueChange={(next) => next && onChange(next as 'all' | 'own')} aria-label="Frames">
      <ToggleGroupItem value="all">All frames {stack.frames.length}</ToggleGroupItem>
      <ToggleGroupItem value="own">Own code {stack.frames.filter((frame) => frame.in_app || frame.library).length}</ToggleGroupItem>
    </ToggleGroup>
  );
}

function StackTab({ stack, hang }: { stack: CrashStack; hang: boolean }) {
  const [scope, setScope] = useState<'all' | 'own'>('all');
  return (
    <Stack gap="block">
      <ActionBar>
        <ActionBarRow>
          <FrameScope stack={stack} value={scope} onChange={setScope} />
        </ActionBarRow>
      </ActionBar>
      <FramesTable stack={stack} onlyOwn={scope === 'own'} crashed hang={hang} />
    </Stack>
  );
}

function ThreadsTab({ stacks }: { stacks: CrashStack[] }) {
  if (stacks.length === 0) return <DataStatePanel kind="empty" title="No other threads in the event" />;
  const withOwn = stacks.filter((stack) => ownFrames(stack).length > 0);
  const systemOnly = stacks.filter((stack) => ownFrames(stack).length === 0);
  return (
    <Accordion type="multiple" className="typography-small">
      {withOwn.map((stack, index) => (
        <AccordionItem key={index} value={String(index)}>
          <AccordionTrigger>
            {stack.name} · {plural(ownFrames(stack).length, 'own frame')}
          </AccordionTrigger>
          <AccordionContent>
            <FramesTable stack={stack} onlyOwn={false} crashed={false} />
          </AccordionContent>
        </AccordionItem>
      ))}
      {systemOnly.length > 0 && (
        <AccordionItem value="system">
          <AccordionTrigger>{plural(systemOnly.length, 'thread')} with system frames only</AccordionTrigger>
          <AccordionContent>
            <Stack gap="block">
              {systemOnly.map((stack, index) => (
                <Stack key={index} gap="block">
                  <span className="text-text-subtle">{stack.name}</span>
                  <FramesTable stack={stack} onlyOwn={false} crashed={false} />
                </Stack>
              ))}
            </Stack>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}

const timelineFilters = {
  all: 'All',
  steps: 'User steps',
  logs: 'App logs',
  network: 'Network',
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
          <div className="max-w-full overflow-x-auto max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
            <ToggleGroup type="single" variant="segmented" value={filter} onValueChange={(next) => next && setFilter(next as TimelineFilter)} aria-label="Filter entries">
              {(Object.keys(timelineFilters) as TimelineFilter[]).map((key) => (
                <ToggleGroupItem key={key} value={key} className="whitespace-nowrap">
                  {timelineFilters[key]} {counts[key]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </ActionBarRow>
      </ActionBar>
      <Table density="compact" stickyHeader maxHeight="70vh">
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 text-right">
              <span className="inline-flex items-center gap-1">
                Relative
                <HelpIcon
                  label="How time is measured"
                  content={
                    occurrence.window.exact
                      ? 'Seconds relative to the hang.'
                      : 'A crash is only stored on the next launch. Time therefore counts from the last activity before it.'
                  }
                />
              </span>
            </TableHead>
            <TableHead className="hidden w-32 sm:table-cell">Clock time</TableHead>
            <TableHead className="hidden w-40 md:table-cell">Process</TableHead>
            <TableHead className="hidden w-36 sm:table-cell">Type</TableHead>
            <TableHead>Content</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, position) => {
            if ('gap' in row) {
              return (
                <TableRow key={`gap-${position}`}>
                  <TableCell colSpan={5} className="text-center text-text-subtle">
                    {row.gap.toLocaleString('en-GB', { maximumFractionDigits: 1 })} s without activity
                  </TableCell>
                </TableRow>
              );
            }
            if ('restart' in row) {
              return (
                <TableRow key={`restart-${position}`}>
                  <TableCell colSpan={5} className="text-center text-text-subtle">
                    App terminated, relaunched at {formatTime(row.restart)}
                  </TableCell>
                </TableRow>
              );
            }
            const { entry } = row;
            const isIssue = entry.id === occurrence.id;
            return (
              <TableRow key={entry.id} className={isIssue ? 'bg-table-background-selected' : undefined} data-state={isIssue ? 'selected' : undefined} aria-current={isIssue ? 'true' : undefined}>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{isIssue && !occurrence.window.exact ? 'after' : relativeSeconds(entry.ts, reference)}</TableCell>
                <TableCell className="hidden tabular-nums whitespace-nowrap sm:table-cell">{formatTime(entry.ts)}</TableCell>
                <TableCell className="hidden md:table-cell">{processLabel(entry.process)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <EntryBadge entry={entry} />
                </TableCell>
                <TableCell className="[overflow-wrap:anywhere]">
                  <div className="mb-1 sm:hidden">
                    <EntryBadge entry={entry} />
                  </div>
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
          <TableHead>Time</TableHead>
          <TableHead className="hidden sm:table-cell">Version</TableHead>
          <TableHead className="hidden md:table-cell">Device</TableHead>
          <TableHead>Process</TableHead>
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
          <TableHead>Symbols</TableHead>
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
              <Badge variant={image.symbols ? 'success' : 'warning'} tinted>{image.symbols ? 'Available' : 'Missing'}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

