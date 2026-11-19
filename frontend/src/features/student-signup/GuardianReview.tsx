import { useEffect, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import { apiMessage } from '../../lib/apiClient';
import { confirmGuardianRelationship, getSignupReview, type SelfProfile } from './profileApi';
export default function GuardianReview({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [profile, setProfile] = useState<SelfProfile | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [method, setMethod] = useState('ENROLMENT_RECORD');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setProfile(null); setError(''); setConfirmed(false);
    getSignupReview(studentId).then(value => { if (!cancelled) setProfile(value); })
      .catch(failure => { if (!cancelled) setError(apiMessage(failure)); });
    return () => { cancelled = true; };
  }, [studentId, reload]);
  const guardian = profile?.guardian;
  const save = async () => {
    if (!guardian || !confirmed || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { setProfile(await confirmGuardianRelationship(studentId, guardian.revision, method)); setConfirmed(false); }
    catch (failure) { setError(apiMessage(failure)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal size="wide" title="Guardian confirmation" titleId="guardian-review-title" closeDisabled={busy} onClose={onClose}
    footer={<button type="button" className="btn" disabled={busy} onClick={onClose}>Close</button>}>
    {!profile && !error && <p role="status">Loading guardian details…</p>}
    {error && <p role="alert">{error}</p>}
    {profile && <div className="self-profile-editor">
      <h3>{profile.name}</h3>
      {!guardian ? <p>No guardian is recorded for this registration.</p> : <>
        <dl>
          <dt>Guardian</dt><dd>{guardian.name}</dd><dt>Relationship</dt><dd>{guardian.relationship}</dd>
          <dt>Email</dt><dd>{guardian.email}</dd><dt>Phone</dt><dd>{guardian.phone}</dd>
          <dt>Email and signup permission</dt><dd>{guardian.emailVerifiedAt && guardian.signupConsentedAt ? 'Confirmed' : 'Awaiting guardian'}</dd>
          <dt>Independent relationship check</dt><dd>{guardian.relationshipConfirmedAt ? 'Confirmed' : 'Not yet confirmed'}</dd>
        </dl>
        <p>Email verification is not proof of guardianship. Check independent enrolment records or complete an in-person relationship check.
          Do not rely only on a call to the newly supplied number.</p>
        {!guardian.relationshipConfirmedAt && <>
          <label className="field">Verification method<select value={method} disabled={busy} onChange={event => setMethod(event.target.value)}>
            <option value="ENROLMENT_RECORD">Previously verified enrolment records</option>
            <option value="IN_PERSON">In-person relationship check</option>
          </select></label>
          <label className="self-profile-check"><input type="checkbox" checked={confirmed} disabled={busy}
            onChange={event => setConfirmed(event.target.checked)} />I independently checked this guardian’s relationship to this student.</label>
          <button type="button" className="btn btn--primary" disabled={busy || !confirmed || !guardian.emailVerifiedAt || !guardian.signupConsentedAt}
            onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm guardian relationship'}</button>
        </>}
        <p>This does not approve the student account or give permission for biometric processing or camera sharing.</p>
      </>}
    </div>}
    <button type="button" className="btn" disabled={busy} onClick={() => setReload(value => value + 1)}>Refresh details</button>
  </Modal>;
}