import type { ProfileInput } from './profileApi';
export function schoolDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isMinor(dateOfBirth: string | null, today = schoolDate()): boolean {
  if (!dateOfBirth || !validDate(dateOfBirth)) return false;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  // Match LocalDate.plusYears: a leap-day birthday reaches the anniversary on February 28.
  const lastDay = new Date(Date.UTC(year + 18, month, 0)).getUTCDate();
  const anniversary = `${year + 18}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  return today < anniversary;
}
export function profileIssue(profile: ProfileInput, requireBirth = true, loginEmail = '', today = schoolDate()): string {
  if (!profile.dateOfBirth && requireBirth) return 'Enter the student’s date of birth.';
  if (profile.dateOfBirth && (!validDate(profile.dateOfBirth) || profile.dateOfBirth >= today))
    return 'Enter a valid date of birth in the past.';
  if (requireBirth && isMinor(profile.dateOfBirth, today) && !profile.guardian) return 'Add a parent or guardian for a student under 18.';
  if (profile.guardian && Object.values(profile.guardian).some(value => !value.trim()))
    return 'Complete every guardian field.';
  const guardianEmail = profile.guardian?.email.trim().toLowerCase();
  if (guardianEmail && [loginEmail, profile.contactEmail].some(value => value.trim().toLowerCase() === guardianEmail))
    return 'Guardian email must differ from the student’s login and contact emails.';
  return '';
}