import { Badge } from '@getitdone-gmbh/kette-design-community';

import type { IssueKind, IssueStatus, TimelineEntry } from '../lib/types';

export const statusLabels: Record<IssueStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  ignored: 'Ignored',
};

// Status colours differ from the kind badges (crash red, hang yellow), so two badges never look alike
const statusVariants = {
  open: 'info',
  investigating: 'outline',
  resolved: 'success',
  ignored: 'secondary',
} as const;

const eventLabels: Record<string, string> = {
  exception: 'Crash',
  app_hang: 'Hang',
  gesture_click: 'Tap',
  gesture_long_click: 'Long press',
  gesture_scroll: 'Scroll',
  screen_view: 'Screen',
  lifecycle_app: 'App state',
  lifecycle_view_controller: 'View controller',
  lifecycle_swift_ui: 'SwiftUI view',
  http: 'HTTP',
  cpu_usage: 'CPU',
  memory_usage_absolute: 'Memory',
  cold_launch: 'Cold launch',
  warm_launch: 'Warm launch',
  hot_launch: 'Launch',
  bug_report: 'Export',
  network_change: 'Network change',
  span: 'Span',
  log: 'Measure log',
};

export const eventLabel = (type: string | null | undefined) => (type ? eventLabels[type] ?? type : 'Event');

export function KindBadge({ kind }: { kind: IssueKind }) {
  return (
    <Badge variant={kind === 'crash' ? 'destructive' : 'warning'} tinted>
      {kind === 'crash' ? 'Crash' : 'Hang'}
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
