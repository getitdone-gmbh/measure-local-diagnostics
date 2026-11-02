import { Badge } from '@getitdone-gmbh/kette-design-community';

import { entryLabel } from '../lib/format';
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
        {entryLabel(entry)}
      </Badge>
    );
  }
  if (entry.event_type === 'exception') return <KindBadge kind="crash" />;
  if (entry.event_type === 'app_hang') return <KindBadge kind="hang" />;
  return <Badge variant="outline">{entryLabel(entry)}</Badge>;
}
