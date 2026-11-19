import { request } from '../../lib/apiClient';

export type AccountLinkPurpose = 'STUDENT_REGISTRATION' | 'STAFF_ACTIVATION' | 'PASSWORD_RESET' | 'STUDENT_EMAIL' | 'GUARDIAN_VERIFICATION';
export interface AccountLinkDetails {
  studentName?: string | null;
  email: string | null;
  purpose: AccountLinkPurpose;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}
function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(`/api/auth/account-links${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}
export function requestAccountLink(email: string, purpose: AccountLinkPurpose) {
  return post<{ message: string }>('', { email, purpose });
}
export function inspectAccountLink(token: string) { return post<AccountLinkDetails>('/inspect', { token }); }
export function resetAccountPassword(token: string, password: string) {
  return post<void>('/reset-password', { token, password });
}

export interface AssistedActivation {
  readonly link: string;
  readonly expiresAt: string;
}

export function activationEligibility(kind: 'STUDENT' | 'STAFF', accountId: string) {
  return request<{ eligible: boolean }>(`/api/admin/account-activations/${kind}/${accountId}`);
}

export function createAssistedActivation(kind: 'STUDENT' | 'STAFF', accountId: string) {
  return request<AssistedActivation>('/api/admin/account-activations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, accountId, identityConfirmed: true }),
  });
}

export function confirmContact(token: string, signupPermission: boolean, noticeVersion: string | null) {
  return post<void>('/confirm-contact', { token, signupPermission, noticeVersion });
}
