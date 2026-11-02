import { Badge } from '@getitdone-gmbh/kette-design-community';

import type { IssueKind, IssueStatus, TimelineEntry } from '../lib/types';

export const statusLabels: Record<IssueStatus, string> = {
  open: 'Offen',
  investigating: 'In Analyse',
  resolved: 'Behoben',
  ignored: 'Ignoriert',
};

const statusVariants = {
  open: 'destructive',
  investigating: 'warning',
  resolved: 'success',
  ignored: 'secondary',
} as const;

const eventLabels: Record<string, string> = {
  exception: 'Absturz',
  app_hang: 'Hänger',
  gesture_click: 'Tippen',
  gesture_long_click: 'Langes Tippen',
  gesture_scroll: 'Scrollen',
  screen_view: 'Screen',
  lifecycle_app: 'App-Status',
  lifecycle_view_controller: 'View-Controller',
  lifecycle_swift_ui: 'SwiftUI-View',
  http: 'HTTP',
  cpu_usage: 'CPU',
  memory_usage_absolute: 'Speicher',
  cold_launch: 'Kaltstart',
  warm_launch: 'Warmstart',
  hot_launch: 'Start',
  bug_report: 'Export',
  network_change: 'Netzwechsel',
  span: 'Messung',
  log: 'Measure-Log',
};

export const eventLabel = (type: string | null | undefined) => (type ? eventLabels[type] ?? type : 'Ereignis');

export function KindBadge({ kind }: { kind: IssueKind }) {
  return (
    <Badge variant={kind === 'crash' ? 'destructive' : 'warning'} tinted>
      {kind === 'crash' ? 'Absturz' : 'Hänger'}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge variant={statusVariants[status]} tinted>
      {statusLabels[status]}
    </Badge>
  );
}

// One mapping for log levels and event types, used by every timeline
export function EntryBadge({ entry }: { entry: Pick<TimelineEntry, 'kind' | 'level' | 'event_type'> }) {
  if (entry.kind === 'app_log') {
    const variant = entry.level === 'error' || entry.level === 'fault' ? 'destructive' : entry.level === 'warning' ? 'warning' : 'secondary';
    return (
      <Badge variant={variant} tinted>
        Log {entry.level}
      </Badge>
    );
  }
  if (entry.event_type === 'exception') return <KindBadge kind="crash" />;
  if (entry.event_type === 'app_hang') return <KindBadge kind="hang" />;
  return <Badge variant="outline">{eventLabel(entry.kind === 'span' ? 'span' : entry.event_type)}</Badge>;
}
