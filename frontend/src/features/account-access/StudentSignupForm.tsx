import type { ComponentProps } from 'react';
import RegisterForm from '../../components/auth/RegisterForm';
import PasswordField from '../../components/PasswordField';
import SelectMenu from '../../components/SelectMenu';
import RegistrationCourseSelector from '../../components/auth/RegistrationCourseSelector';
import { STUDENT_LEVEL_OPTIONS } from '../../lib/studentLevels';
import { ProfileFields, isMinor, type ProfileInput } from '../student-signup';

type Props = ComponentProps<typeof RegisterForm> & { profile: ProfileInput; onProfileChange: (value: ProfileInput) => void };
export default function StudentSignupForm(p: Props) {
  const minor = isMinor(p.profile.dateOfBirth);
  return <form className="auth-card auth-card--wide auth-card--registration" onSubmit={p.onSubmit} aria-busy={p.busy}>
    {p.onBack && <button type="button" className="auth-card__back" onClick={p.onBack} disabled={p.busy}>Back to home</button>}
    <h2 className="auth-card__title">Create your student account</h2>
    <p className="auth-card__sub">Use the Student ID supplied by the school. A guardian must verify their email and give signup permission when included. School approval is still required.</p>
    {!p.verifiedEmail && <button type="button" className="auth-card__back" onClick={() => p.onSwitchRole('teacher')}>Activate a staff account instead</button>}
    <fieldset disabled={p.busy} className="signup-profile-fields">
      <div className="auth-form__grid">
        <label className="field">Student ID<input required maxLength={80} value={p.studentNumber}
          onChange={event => p.onStudentNumberChange(event.target.value)} /></label>
        <label className="field">Student full name<input required autoComplete="name" value={p.fullName}
          onChange={event => p.onFullNameChange(event.target.value)} /></label>
        <label className="field">Login email<input required type="email" maxLength={255} autoComplete="email"
          readOnly={p.verifiedEmail} value={p.email} onChange={event => p.onEmailChange(event.target.value)} /></label>
        <label className="field">Level<SelectMenu value={p.level} options={STUDENT_LEVEL_OPTIONS}
          onChange={p.onLevelChange} ariaLabel="Level" /></label>
      </div>
      <ProfileFields value={p.profile} onChange={p.onProfileChange} />
      <RegistrationCourseSelector classes={p.classes} loading={p.classesLoading} error={p.classesError}
        selectedClassIds={p.selectedClassIds} onSelectionChange={p.onClassSelectionChange} />
      <fieldset className="registration-attendance-choice">
        <legend>Attendance method</legend>
        <label><input type="radio" name="attendance-method" checked={p.attendanceMode === 'MANUAL'}
          onChange={() => p.onAttendanceModeChange('MANUAL')} /> Manual attendance</label>
        <label><input type="radio" name="attendance-method" checked={p.attendanceMode === 'FACE'}
          disabled={!p.faceEnabled || minor} onChange={() => p.onAttendanceModeChange('FACE')} />
          Face attendance — optional adult volunteer pilot</label>
        {minor && <p>Guardian signup permission does not authorize face processing. Students under 18 use manual attendance in this pilot.</p>}
      </fieldset>
      <div className="auth-form__grid">

        <PasswordField label="Password" value={p.password} onChange={p.onPasswordChange} show={p.showPassword}
          onToggleShow={p.onToggleShowPassword} autoComplete="new-password" />
        <PasswordField label="Confirm password" value={p.confirmPassword} onChange={p.onConfirmPasswordChange}
          show={p.showPassword} onToggleShow={p.onToggleShowPassword} autoComplete="new-password" />
      </div>
    </fieldset>
    {p.errorMessage && <p role="alert" className="form-error">{p.errorMessage}</p>}
    <button type="submit" className="btn btn--primary auth-form__submit" disabled={p.busy}>
      {p.busy ? 'Submitting…' : p.attendanceMode === 'FACE' ? 'Continue to face registration' : 'Submit signup application'}
    </button>
    <button type="button" className="auth-card__back" onClick={p.onSwitchToLogin} disabled={p.busy}>Already registered? Sign in</button>
  </form>;
}