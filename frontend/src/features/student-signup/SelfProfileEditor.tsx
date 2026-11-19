import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiMessage } from '../../lib/apiClient';
import { useWorkflowCapabilities } from '../../lib/workflowCapabilities';
import { getSelfProfile, saveSelfProfile, profileInput, requestContactVerification, type SelfProfile, type ProfileInput } from './profileApi';
import { profileIssue } from './profileFormModel';
import ProfileFields from './ProfileFields';

export default function SelfProfileEditor({ pending = false }: { pending?: boolean }) {
  const [saved, setSaved] = useState<SelfProfile | null>(null);
  const [draft, setDraft] = useState<ProfileInput | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef(true);
  const submitting = useRef(false);
  const availability = useWorkflowCapabilities();
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    getSelfProfile().then(value => { if (!cancelled) { setSaved(value); setDraft(profileInput(value)); setError(''); } })
      .catch(failure => { if (!cancelled) setError(apiMessage(failure)); });
    return () => { cancelled = true; active.current = false; };
  }, [reload]);
  const dirty = saved && draft && JSON.stringify(profileInput(saved)) !== JSON.stringify(draft);
  const run = async (action: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (failure) { if (active.current) setError(apiMessage(failure)); }
    finally { submitting.current = false; if (active.current) setBusy(false); }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!saved || !draft) return;
    const issue = profileIssue(draft, pending, saved.loginEmail);
    if (issue) { setError(issue); return; }
    void run(async () => {
      const value = await saveSelfProfile(saved.version, draft);
      if (active.current) { setSaved(value); setDraft(profileInput(value)); setMessage('Profile saved.'); }
    });
  };
  const send = (purpose: 'STUDENT_EMAIL' | 'GUARDIAN_VERIFICATION') => void run(async () => {
    await requestContactVerification(purpose);
    if (active.current) setMessage('Verification requested. Check the recipient’s inbox and spam folder.');
  });
  return <section className="self-profile-editor">
    <h2>{pending ? 'Complete your signup checks' : 'My profile'}</h2>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!saved && !error && <p role="status">Loading your profile…</p>}
    {saved && draft && <>
      <p><strong>{saved.name}</strong> · Student ID {saved.studentNumber}</p>
      <p>Login email: {saved.loginEmail}. Contact the school to change your login identity.</p>
      <form onSubmit={save} aria-busy={busy}>
        <ProfileFields value={draft} onChange={setDraft} disabled={busy} birthLocked={!!saved.dateOfBirth}
          guardianLocked={!pending} requireBirth={pending} />
        <button className="btn btn--primary" type="submit" disabled={busy || !dirty}>Save profile</button>
      </form>
      <section className="self-profile-status" aria-label="Verification status">
        <p>Login email: {saved.emailVerifiedAt ? 'Verified' : 'Not verified'}</p>
        {saved.guardian && <>
          <p>Guardian email and signup permission: {saved.guardian.emailVerifiedAt ? 'Confirmed' : 'Awaiting guardian'}</p>
          <p>Guardian relationship: {saved.guardian.relationshipConfirmedAt ? 'Confirmed by the school' : 'Awaiting independent school confirmation'}</p>
        </>}
        {pending && <p>Guardian or email verification does not approve your account. An administrator must review your registration.</p>}
        {availability.capabilities?.accountEmail === false && <p>Verification email is unavailable in this environment. Contact the school. No verification email has been sent.</p>}
        {availability.error && <p role="alert">{availability.error}</p>}
        <div className="self-profile-actions">
          {!saved.emailVerifiedAt && <button className="btn" disabled={busy || !!dirty || !availability.capabilities?.accountEmail}
            onClick={() => send('STUDENT_EMAIL')}>Verify login email</button>}
          {saved.guardian && !saved.guardian.emailVerifiedAt && <button className="btn" disabled={busy || !!dirty || !availability.capabilities?.accountEmail}
            onClick={() => send('GUARDIAN_VERIFICATION')}>Send guardian verification</button>}
        </div>
        {dirty && <p>Save your changes before requesting verification.</p>}
      </section>
    </>}
    <button className="btn" disabled={busy} onClick={() => { setMessage(''); setReload(value => value + 1); }}>
      {dirty ? 'Discard edits and reload saved profile' : 'Refresh saved profile and status'}
    </button>
  </section>;
}