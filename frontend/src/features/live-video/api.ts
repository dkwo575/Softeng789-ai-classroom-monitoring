import { request } from '../../lib/apiClient';
export type StreamView = { id: string; studentId: string; name: string; viewer: string | null; viewerName: string | null; sdp: string | null };
export type Workspace = { enabled: boolean; noticeVersion: string; sessions: { id: string; course: string; startTime: string; open: boolean }[] };
export type Board = { enabled: boolean; streams: StreamView[] };
// Bound the full operation including apiClient's CSRF acquisition, not only the final fetch.
async function call<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request<T>(`/api/live-video${path}`, { method, signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Video connection timed out. Start again explicitly.')), 9000); })]); }
  finally { clearTimeout(timer); }
}
export const videoApi = {
  workspace: (student: string) => call<Workspace>(`/students/${student}/sessions`),
  start: (student: string, session: string, id: string, noticeVersion: string) => call<StreamView>(`/students/${student}/sessions/${session}/streams`, 'POST', { id, noticeVersion, adultConfirmed: true, consent: true }),
  pulse: (student: string, id: string, viewer: string | null, sdp: string | null) => call<StreamView>(`/students/${student}/streams/${id}/pulse`, 'POST', { viewer, sdp }),
  stop: (student: string, id: string) => call<void>(`/students/${student}/streams/${id}`, 'DELETE'),
  board: (session: string) => call<Board>(`/sessions/${session}/streams`),
  watch: (session: string, id: string, viewer: string, sdp: string | null) => call<StreamView>(`/sessions/${session}/streams/${id}/viewer`, 'POST', { viewer, sdp }),
  leave: (session: string, id: string, viewer: string) => call<void>(`/sessions/${session}/streams/${id}/viewer/${viewer}`, 'DELETE')
};
