import { type FormEvent, useEffect, useState } from 'react';
import LoginForm from '../components/auth/LoginForm';
import StudentFaceRegistrationStep from '../components/auth/StudentFaceRegistrationStep';
import { hasRequiredEnrollmentCaptures } from '../lib/faceEnrollment';
import { request } from '../lib/apiClient';
import type { FaceEnrollmentCapture } from '../types';
import RegisterForm from '../components/auth/RegisterForm';
import { apiMessage } from '../lib/apiClient';
import { listPublicClasses, type PublicClassSummaryApiResponse } from '../lib/classAdminApi';
import { isEmailAddress } from '../lib/emailAddress';
import type { Auth } from '../hooks/useAuth';
import type { StudentLevel, UserRole } from '../types';
import { AccountLinkRequestForm, StudentSignupForm, ContactVerification, passwordIssue, type AccountLinkDetails } from '../features/account-access';
import { emptyProfile, profileIssue, isMinor, type ProfileInput } from '../features/student-signup';

type Mode = 'login' | 'register' | 'recover';

interface Props {
  readonly auth: Auth;
  readonly initialMode?: Mode;
  readonly onBack?: () => void;
  readonly verification?: AccountLinkDetails & { token: string };
  readonly onRegistered?: () => void;
}

export default function AuthPage({ auth, initialMode = 'login', onBack, verification, onRegistered }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [role, setRole] = useState<UserRole>(verification && verification.role !== 'STUDENT' ? 'teacher' : 'student');
  const [attendanceMode, setAttendanceMode] = useState<'MANUAL' | 'FACE'>('MANUAL');
  const [faceStep, setFaceStep] = useState(false);
  const [consent, setConsent] = useState(false);
  const [captures, setCaptures] = useState<FaceEnrollmentCapture[]>([]);
  const [options, setOptions] = useState({ faceEnabled: false, noticeVersion: '' });
  useEffect(() => {
    let cancelled = false;
    request<{ faceEnabled: boolean; noticeVersion: string }>('/api/auth/registration-options')
      .then(value => { if (!cancelled) setOptions(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');

  const [email, setEmail] = useState(verification?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [studentNumber, setStudentNumber] = useState('');
  const [signupProfile, setSignupProfile] = useState<ProfileInput>(emptyProfile);
  const [fullName, setFullName] = useState('');
  const [level, setLevel] = useState<StudentLevel>('LEVEL_1');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);

  const [classes, setClasses] = useState<PublicClassSummaryApiResponse[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classesError, setClassesError] = useState('');

  const [staffNumber, setStaffNumber] = useState('');
  const [teacherName, setTeacherName] = useState('');

  const errorMessage = localError || auth.error;

  useEffect(() => {
    if (mode !== 'register' || role !== 'student') return;
    let cancelled = false;
    setClassesLoading(true);
    setClassesError('');
    listPublicClasses()
      .then((result) => {
        if (!cancelled) {
          setClasses(result);
          setClassesError('');
        }
      })
      .catch((error) => {
        if (!cancelled) setClassesError(apiMessage(error));
      })
      .finally(() => {
        if (!cancelled) setClassesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, role]);

  const switchMode = (next: Mode) => {
    setMode(next); setFaceStep(false); setCaptures([]); setConsent(false);
    setLocalError('');
    auth.clearError();
  };

  const switchRole = (next: UserRole) => {
    setRole(next); setFaceStep(false); setCaptures([]); setConsent(false);
    setLocalError('');
    auth.clearError();
  };

  const changeSelectedClasses = (ids: string[]) => {
    setSelectedClassIds(ids);
    setLocalError('');
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    if (!email.trim() || !password) {
      setLocalError('Enter your Student ID or email and password.');
      return;
    }
    await auth.login({ email: email.trim(), password });
  };

  const prepareFaceRegistration = () => {
    if (attendanceMode !== 'FACE') return true;
    if (!options.faceEnabled) {
      setLocalError('Face registration is unavailable. Choose manual attendance.');
      return false;
    }
    if (!faceStep) {
      setFaceStep(true);
      return false;
    }
    if (!consent || !hasRequiredEnrollmentCaptures(captures)) {
      setLocalError('Confirm consent and complete all seven captures.');
      return false;
    }
    return true;
  };

  const submitStudentRegistration = async () => {
    const issue = profileIssue(signupProfile, true, email);
    if (issue) { setLocalError(issue); return; }
    if (isMinor(signupProfile.dateOfBirth) && attendanceMode === 'FACE') {
      setLocalError('Face attendance remains an adult volunteer pilot. Choose manual attendance.'); return;
    }
    if (!prepareFaceRegistration()) return;
    const courseLabel = classes.filter((klass) => selectedClassIds.includes(klass.id)).map((klass) => klass.courseCode).join(', ');
    const payload = { studentNumber: studentNumber.trim(), universityEmail: email.trim(),
      fullName: fullName.trim(), course: courseLabel, classOfferingIds: selectedClassIds,
      password, consentGiven: attendanceMode === 'FACE' && consent, level, attendanceMode,
      adultConfirmed: attendanceMode === 'FACE' && consent, noticeVersion: options.noticeVersion,
      emailProof: verification?.token, profile: signupProfile };
    const registered = await auth.registerStudent(payload, attendanceMode === 'FACE' ? captures : []);
    if (registered) onRegistered?.();
  };

  const submitRegister = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');

    const issue = passwordIssue(password, confirmPassword);
    if (issue) { setLocalError(issue); return; }

    if (role === 'student') {
      if (!studentNumber.trim() || !email.trim() || !fullName.trim()) {
        setLocalError('Fill in every field.');
        return;
      }
      if (!isEmailAddress(email.trim())) {
        setLocalError('Enter a valid login email address.');
        return;
      }
      if (selectedClassIds.length === 0) {
        setLocalError('Select at least one class.');
        return;
      }
      await submitStudentRegistration();
      return;
    }

    if (!staffNumber.trim() || !email.trim() || !teacherName.trim()) {
      setLocalError('Fill in every field.');
      return;
    }
    const registered = await auth.registerTeacher({
      staffNumber: staffNumber.trim(),
      email: email.trim(),
      name: teacherName.trim(),
      password,
      emailProof: verification?.token ?? ''
    });
    if (registered) onRegistered?.();
  };

  if (verification && (verification.purpose === 'STUDENT_EMAIL' || verification.purpose === 'GUARDIAN_VERIFICATION')) {
    return <ContactVerification token={verification.token} details={verification} />;
  }
  if (mode === 'login') {
    return <LoginForm
      email={email}
      onEmailChange={setEmail}
      password={password}
      onPasswordChange={setPassword}
      showPassword={showPassword}
      onToggleShowPassword={() => setShowPassword((current) => !current)}
      errorMessage={errorMessage}
      busy={auth.busy}
      onSubmit={submitLogin}
      onSwitchToRegister={() => switchMode('register')}
      onForgotPassword={() => switchMode('recover')}
      onBack={onBack}
    />;
  }

  if (mode === 'recover' || (mode === 'register' && role !== 'student' && !verification)) {
    const registrationPurpose = role === 'student' ? 'STUDENT_REGISTRATION' : 'STAFF_ACTIVATION';
    const purpose = mode === 'recover' ? 'PASSWORD_RESET' : registrationPurpose;
    return <AccountLinkRequestForm purpose={purpose}
      onPurposeChange={purpose => switchRole(purpose === 'STUDENT_REGISTRATION' ? 'student' : 'teacher')}
      onBack={() => switchMode('login')} />;
  }


  if (faceStep && role === 'student') return <StudentFaceRegistrationStep
    noticeVersion={options.noticeVersion}
    fullName={fullName} studentNumber={studentNumber}
    classLabels={classes.filter(c => selectedClassIds.includes(c.id)).map(c => c.courseCode)}
    consentGiven={consent} onConsentChange={value => { setConsent(value); if (!value) setCaptures([]); }}
    captures={captures} onCapturesChange={(next) => { setCaptures(next); setLocalError(''); auth.clearError(); }} busy={auth.busy} errorMessage={errorMessage}
    onSubmit={submitRegister} onBackToDetails={() => { setFaceStep(false); setCaptures([]); setConsent(false); setLocalError(''); auth.clearError(); }}
  />;

  const DetailsForm = role === 'student' ? StudentSignupForm : RegisterForm;
  return (
    <DetailsForm
      profile={signupProfile} onProfileChange={setSignupProfile}
      attendanceMode={attendanceMode} onAttendanceModeChange={setAttendanceMode} faceEnabled={options.faceEnabled}
      verifiedEmail={!!verification}
      role={role}
      onSwitchRole={switchRole}
      email={email}
      onEmailChange={setEmail}
      password={password}
      onPasswordChange={setPassword}
      confirmPassword={confirmPassword}
      onConfirmPasswordChange={setConfirmPassword}
      showPassword={showPassword}
      onToggleShowPassword={() => setShowPassword((current) => !current)}
      fullName={fullName}
      onFullNameChange={setFullName}
      studentNumber={studentNumber}
      onStudentNumberChange={setStudentNumber}
      level={level}
      onLevelChange={setLevel}
      classes={classes}
      classesLoading={classesLoading}
      classesError={classesError}
      selectedClassIds={selectedClassIds}
      onClassSelectionChange={changeSelectedClasses}
      staffNumber={staffNumber}
      onStaffNumberChange={setStaffNumber}
      teacherName={teacherName}
      onTeacherNameChange={setTeacherName}
      errorMessage={errorMessage}
      busy={auth.busy}
      onSubmit={submitRegister}
      onSwitchToLogin={() => switchMode('login')}
      onBack={onBack}
    />
  );
}
