import type { Frame, Occurrence, Stack } from './types';

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium' });
const dateMinutes = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

export const formatDateTime = (value: string | null | undefined) => (value ? dateTime.format(new Date(value)) : 'unknown');
export const formatTime = (value: string) => time.format(new Date(value));
export const formatDateMinutes = (value: string | null | undefined) => (value ? dateMinutes.format(new Date(value)) : 'unknown');

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-GB')} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MB`;
}

// Offset of a timeline entry relative to the reference point, e.g. "−1.7 s"
export function relativeSeconds(value: string, reference: string): string {
  const seconds = (new Date(value).getTime() - new Date(reference).getTime()) / 1000;
  const sign = seconds < 0 ? '−' : seconds > 0 ? '+' : '±';
  return `${sign}${Math.abs(seconds).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

export const processLabel = (process: string) => (process === 'autofill' ? 'Autofill extension' : 'App');

// Crashes are stored on the next launch, so the last activity is the honest reference for "before the crash"
export const referenceTime = (occurrence: Pick<Occurrence, 'window' | 'ts'>) => (occurrence.window.exact ? occurrence.ts : occurrence.window.after);

export function crashTimeLabel(occurrence: Pick<Occurrence, 'window' | 'ts'>): string {
  if (occurrence.window.exact) return formatDateTime(occurrence.ts);
  return `between ${formatTime(occurrence.window.after)} and ${formatTime(occurrence.window.before)} (${formatDateTime(occurrence.window.before).split(',')[0]})`;
}

export function frameLabel(frame: Frame): string {
  if (frame.function) return frame.function;
  return frame.offset ?? frame.address ?? 'unknown';
}

export function frameLocation(frame: Frame): string | null {
  if (!frame.file || frame.file.startsWith('<')) return null;
  const name = frame.file.split('/').pop();
  return frame.line ? `${name}:${frame.line}` : name ?? null;
}

function stackToMarkdown(stack: Stack): string {
  return [
    `**${stack.name}**${stack.reason ? `: ${stack.reason}` : ''}`,
    '```',
    ...stack.frames.map((frame) => `${String(frame.index ?? '').padStart(3)}  ${(frame.binary ?? '').padEnd(28)} ${frameLabel(frame)}${frameLocation(frame) ? ` (${frameLocation(frame)})` : ''}`),
    '```',
  ].join('\n');
}

// Ticket-ready summary for Jira or Workbase
export function occurrenceToMarkdown(title: string, occurrence: Occurrence, link: string): string {
  const context = occurrence.context;
  const crashed = occurrence.stacks.find((stack) => stack.crashed) ?? occurrence.stacks[0];
  const reference = referenceTime(occurrence);
  const lastSteps = occurrence.timeline
    .filter((entry) => new Date(entry.ts) <= new Date(reference) && entry.id !== occurrence.id)
    .slice(-15)
    .map((entry) => `- \`${relativeSeconds(entry.ts, reference)}\` ${processLabel(entry.process)}, ${entry.event_type ?? entry.category ?? entry.kind}: ${entry.message ?? ''}`);
  return [
    `## ${title}`,
    '',
    `[Open in diagnostics](${link})`,
    '',
    `| | |`,
    `|---|---|`,
    `| Time | ${crashTimeLabel(occurrence)} |`,
    `| Process | ${processLabel(occurrence.process)} |`,
    `| App | ${context.app_version ?? '?'} (${context.app_build ?? '?'}) |`,
    `| Device | ${context.device_model ?? '?'}, iOS ${context.os_version ?? '?'} |`,
    `| Import | ${context.import ?? '?'} |`,
    ...(occurrence.duration_ms ? [`| Duration | ${occurrence.duration_ms} ms |`] : []),
    '',
    occurrence.window.exact ? '' : '_The crash is stored on the next launch. Times are relative to the last activity before it._',
    '',
    crashed ? stackToMarkdown(crashed) : '',
    '',
    '**Last steps before**',
    ...lastSteps,
  ].join('\n');
}
