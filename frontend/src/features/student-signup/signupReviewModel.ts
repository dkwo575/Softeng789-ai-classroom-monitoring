import type { SelfProfile } from './profileApi';
import { isMinor } from './profileFormModel';

export interface SignupReviewStatus { ready: boolean; label: string; minor: boolean }
export const checkingSignup: SignupReviewStatus = { ready: false, label: 'Checking guardian requirements…', minor: false };
export const unavailableSignup: SignupReviewStatus = { ready: false, label: 'Guardian status unavailable — reopen review or refresh the queue to retry', minor: false };

export function signupReviewStatus(profile: SelfProfile): SignupReviewStatus {
  const minor = isMinor(profile.dateOfBirth);
  const guardian = profile.guardian;
  const required = profile.signupChecksRequired && (!!guardian || minor);
  let label = 'Guardian verification not required';
  let complete = !minor;
  if (guardian) {
    const email = guardian.email.trim().toLowerCase();
    if ([profile.loginEmail, profile.contactEmail ?? ''].some(value => value.trim().toLowerCase() === email)) {
      label = 'Guardian email must differ from the student’s emails';
    } else if (!guardian.emailVerifiedAt) {
      label = 'Guardian email verification pending';
    } else if (!guardian.signupConsentedAt) {
      label = 'Guardian signup permission pending';
    } else if (!guardian.relationshipConfirmedAt) {
      label = 'Guardian relationship confirmation pending';
    } else {
      label = 'Guardian verification complete';
      return { ready: true, label, minor };
    }
    complete = false;
  } else if (required) {
    label = 'Guardian details required';
  }
  if (!required && (guardian || minor)) label += ' — not required for approval of this existing account';
  return { ready: !required || complete, label, minor };
}

export interface RegistrationFaceStatus { attendanceMode?: string; faceReviewState?: string }
export function registrationReadiness(student: RegistrationFaceStatus, signup = checkingSignup): SignupReviewStatus {
  if (student.attendanceMode === 'FACE' && signup.minor)
    return { ...signup, ready: false, label: 'Under-18 student — switch to manual attendance before approval' };
  if (!signup.ready) return signup;
  if (student.attendanceMode === 'FACE' && student.faceReviewState !== 'PENDING')
    return { ...signup, ready: false, label: 'Photos expired or unavailable — manual attendance available' };
  return { ...signup, ready: true, label: 'Ready for review' };
}
