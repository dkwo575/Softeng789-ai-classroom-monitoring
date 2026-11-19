import { useRef, useState, type FormEvent } from 'react';
import { apiMessage } from '../../lib/apiClient';
import { requestAccountLink, type AccountLinkPurpose } from './api';
import { isAccountEmail } from './accountLinkModel';
import { useWorkflowCapabilities } from '../../lib/workflowCapabilities';
import './account-access.css';

interface Props {
  readonly purpose: AccountLinkPurpose;
  readonly onPurposeChange?: (purpose: AccountLinkPurpose) => void;
  readonly onBack: () => void;
}
export default function AccountLinkRequestForm({ purpose, onPurposeChange, onBack }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const availability = useWorkflowCapabilities();
  const emailAvailable = availability.capabilities?.accountEmail === true;
  const reset = purpose === 'PASSWORD_RESET';
  let subtitle = 'Checking available account options.';
  if (availability.capabilities) {
    if (emailAvailable) {
      subtitle = reset
        ? 'Use the email registered to your account. We will send a single-use link valid for 30 minutes.'
        : 'Staff must already have an account added by an administrator. Request a link to set your first password.';
    } else {
      subtitle = reset
        ? 'Password recovery by email is not available in this environment. Your password has not been changed.'
        : 'Ask an administrator to help activate your account. New students can submit an application; guardian confirmation may still be required before approval.';
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || !emailAvailable) return;
    setError('');
    const address = email.trim();
    if (!isAccountEmail(address)) {
      setError('Enter a valid email address.'); return;
    }
    submitting.current = true; setBusy(true);
    try { setMessage((await requestAccountLink(address, purpose)).message); }
    catch (error_) { setError(apiMessage(error_)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form className="auth-card account-access" onSubmit={submit} aria-busy={busy}>
    <button type="button" className="auth-card__back" onClick={onBack} disabled={busy}>Back to sign in</button>
    <h2 className="auth-card__title">{reset ? 'Reset your password' : 'Activate your staff account'}</h2>
    <p className="auth-card__sub">{subtitle}</p>
    <div className="auth-form">
      {!reset && onPurposeChange && <fieldset className="account-access__roles" disabled={busy || !!message}>
        <legend>Account type</legend>
        {(['STUDENT_REGISTRATION', 'STAFF_ACTIVATION'] as const).map(option => <label key={option}>
          <input type="radio" name="account-type" checked={purpose === option} onChange={() => onPurposeChange(option)} />
          {option === 'STUDENT_REGISTRATION' ? 'Student' : 'Staff'}
        </label>)}
      </fieldset>}
      {availability.error && <div className="form-error" role="alert">Could not check account options. {availability.error}
        <button type="button" className="btn" onClick={availability.retry}>Check again</button>
      </div>}
      {!availability.capabilities && !availability.error && <output>Checking account options…</output>}
      {availability.capabilities && !emailAvailable && <p className="account-access__notice">
        {reset ? 'Email recovery is not enabled yet. If you still know your password, go back and sign in.'
          : 'For local testing, an administrator can create a private, single-use activation link from your staff account. No email is sent.'}
      </p>}
      {emailAvailable && <><label className="field"><span>Email</span>
        <input type="email" autoComplete="email" required maxLength={255} value={email}
          onChange={event => setEmail(event.target.value)} disabled={busy || !!message} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message ? <section className="account-access__notice">
        <h3>Check your inbox</h3><output>{message}</output>
        <p>Opening the email link does not change your password. Only submitting the next form does.</p>
      </section> : <button type="submit" className="btn btn--primary auth-form__submit" disabled={busy}>
        {busy ? 'Requesting link…' : 'Send email link'}
      </button>}</>}
    </div>
  </form>;
}
