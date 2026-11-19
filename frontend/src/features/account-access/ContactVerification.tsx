import { useRef, useState, type FormEvent } from 'react';
import { apiMessage } from '../../lib/apiClient';
import { confirmContact, type AccountLinkDetails } from './api';
const NOTICE = 'guardian-signup-v1';
export default function ContactVerification({ token, details }: { token: string; details: AccountLinkDetails }) {
  const guardian = details.purpose === 'GUARDIAN_VERIFICATION';
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || (guardian && !permission)) return;
    submitting.current = true; setBusy(true); setError('');
    try { await confirmContact(token, guardian && permission, guardian ? NOTICE : null); setDone(true); }
    catch (failure) { setError(apiMessage(failure)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form className="auth-card account-access" onSubmit={submit} aria-busy={busy}>
    <h1>{done ? 'Confirmation recorded' : guardian ? 'Guardian signup confirmation' : 'Verify your login email'}</h1>
    {done ? <p role="status">Your confirmation was recorded. School approval is still required. You may close this page.</p> : <>
      {!guardian && <p>Email: {details.email}</p>}
      {guardian && <>
        <p>Student: <strong>{details.studentName}</strong></p>
        <p>Confirm only if you are this student’s parent or guardian and you permit this signup.
          The school will independently check your relationship.</p>
        <p>This permission does not cover face recognition, local camera analysis, observation sharing or live video.
          Contact the school if the student or request is unfamiliar, or if you need to withdraw permission.</p>
        <label className="self-profile-check"><input type="checkbox" required checked={permission}
          onChange={event => setPermission(event.target.checked)} disabled={busy} />
          I am the student’s parent or guardian and give permission for this signup.</label>
      </>}
      {error && <p role="alert">{error}</p>}
      <button className="btn btn--primary" type="submit" disabled={busy || (guardian && !permission)}>
        {busy ? 'Confirming…' : guardian ? 'Verify email and confirm signup permission' : 'Verify email'}
      </button>
    </>}
  </form>;
}