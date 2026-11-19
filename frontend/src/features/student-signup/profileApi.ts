import { request } from '../../lib/apiClient';
export interface GuardianInput { name: string; relationship: string; email: string; phone: string }
export interface ProfileInput {
  dateOfBirth: string | null; schoolName: string; address: string; phone: string; contactEmail: string;
  guardian: GuardianInput | null;
}
export interface SelfProfile extends ProfileInput {
  id: string; studentNumber: string; name: string; loginEmail: string; version: number;
  signupChecksRequired: boolean; emailVerifiedAt: string | null;
  guardian: (GuardianInput & { emailVerifiedAt: string | null; signupConsentedAt: string | null;
    relationshipConfirmedAt: string | null; revision: string }) | null;
}
export const emptyProfile = (): ProfileInput => ({
  dateOfBirth: null, schoolName: '', address: '', phone: '', contactEmail: '', guardian: null,
});
export function profileInput(value: SelfProfile): ProfileInput {
  return { dateOfBirth: value.dateOfBirth, schoolName: value.schoolName ?? '', address: value.address ?? '',
    phone: value.phone ?? '', contactEmail: value.contactEmail ?? '', guardian: value.guardian ? {
      name: value.guardian.name, relationship: value.guardian.relationship,
      email: value.guardian.email, phone: value.guardian.phone,
    } : null };
}
export function getSelfProfile() { return request<SelfProfile>('/api/auth/signup/profile'); }
export function saveSelfProfile(version: number, profile: ProfileInput) {
  return request<SelfProfile>('/api/auth/signup/profile', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, profile }) });
}
export function requestContactVerification(purpose: 'STUDENT_EMAIL' | 'GUARDIAN_VERIFICATION') {
  return request<void>('/api/auth/signup/verification', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose }) });
}
export function getSignupReview(id: string) {
  return request<SelfProfile>(`/api/students/${encodeURIComponent(id)}/signup-profile`);
}
export function confirmGuardianRelationship(id: string, revision: string, method: string) {
  return request<SelfProfile>(`/api/students/${encodeURIComponent(id)}/guardian-confirmation`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, method, relationshipConfirmed: true }) });
}