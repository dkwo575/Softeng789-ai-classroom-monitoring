import type { SharedEvent } from './sharingApi';

// Group only the displayed page. Counts never imply one continuous behavioural interval.
export function reviewGroups(events: SharedEvent[]) {
  const groups = new Map<string, { key: string; studentId: string; kind: SharedEvent['kind']; reports: SharedEvent[] }>();
  for (const event of events) {
    if (event.reviewState !== 'PENDING' || !['NO_FACE', 'MULTIPLE_FACES'].includes(event.kind)) continue;
    const key = `${event.studentId}:${event.kind}`;
    if (!groups.has(key)) groups.set(key, { key, studentId: event.studentId, kind: event.kind, reports: [] });
    groups.get(key)!.reports.push(event);
  }
  return [...groups.values()];
}
