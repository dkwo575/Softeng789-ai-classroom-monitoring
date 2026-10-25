import { request } from '../../lib/apiClient';
import type { Observation } from './observationModel';

export type SharingRun = { id: string; state: string; lastHeartbeat: string; expiresAt: string; sequence: number };
export type SharingWorkspace = { enabled: boolean; noticeVersion: string; sessions: { id: string; course: string; startTime: string; endTime: string; open: boolean }[] };
export type SharedEvent = { id: string; studentId: string; kind: Observation; durationMs: number; receivedAt: string; reviewState: 'INFO' | 'PENDING' | 'REVIEWED' | 'FALSE_POSITIVE'; reviewedAt: string | null };
export type SharingDashboard = { enabled: boolean; serverTime: string; students: { id: string; name: string; connection: SharingRun | null; summary: { headMovements: number; noFaceReports: number; multipleFaceReports: number; pendingChecks: number } }[]; events: SharedEvent[]; hasMore: boolean; page: number };
export type SharedSample = { kind: Observation; durationMs: number };
const studentPath = (id: string) => `/api/webcam/students/${encodeURIComponent(id)}`;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
// apiClient obtains CSRF before fetch; bound that acquisition too, not just the final fetch.
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Sharing request timed out.')), 13000); })]); }
  finally { clearTimeout(timer!); }
}
export const sharingApi = {
  workspace: (student: string, signal?: AbortSignal) => request<SharingWorkspace>(`${studentPath(student)}/sessions`, { signal }),
  start: (student: string, session: string, id: string, noticeVersion: string) => bounded(request<SharingRun>(`${studentPath(student)}/sessions/${encodeURIComponent(session)}/runs`, json({ id, adultConfirmed: true, sharingConsent: true, noticeVersion }))),
  pulse: (student: string, run: string, sequence: number, camera: 'STARTING' | 'RUNNING' | 'PAUSED', events: SharedSample[]) => bounded(request<SharingRun>(`${studentPath(student)}/runs/${run}/pulse`, json({ sequence, camera, events }))),
  stop: (student: string, run: string) => bounded(request<void>(`${studentPath(student)}/runs/${run}/stop`, json({}))),
  withdraw: (student: string) => bounded(request<void>(`${studentPath(student)}/sharing`, { method: 'DELETE', signal: AbortSignal.timeout(12000) })),
  dashboard: (session: string, page: number, signal?: AbortSignal, checksOnly = true) => request<SharingDashboard>(`/api/webcam/sessions/${encodeURIComponent(session)}/observations?page=${page}&checksOnly=${checksOnly}`, { signal }),
  reviewBatch: (session: string, ids: string[], decision: 'REVIEWED' | 'FALSE_POSITIVE') => bounded(request<SharedEvent[]>(`/api/webcam/sessions/${encodeURIComponent(session)}/observations/review`, json({ ids, decision }))),
  review: (id: string, decision: 'REVIEWED' | 'FALSE_POSITIVE') => bounded(request<SharedEvent>(`/api/webcam/observations/${encodeURIComponent(id)}/review`, json({ decision })))
};
