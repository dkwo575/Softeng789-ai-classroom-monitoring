import './registrationFace.css';
import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { useSignupReviews, registrationReadiness, checkingSignup } from '../../features/student-signup';
import { apiMessage, request } from '../../lib/apiClient';
import type { PendingStudentApiResponse } from '../../lib/studentApi';

interface Review { attendanceMode: string; state: string; expiresAt: string | null; photos: string[] }
export default function RegistrationReview({ student, busy, error, onClose, onApprove }: {
  student: PendingStudentApiResponse; busy: boolean; error: string; onClose: () => void; onApprove: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [loadError, setLoadError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const signup = useSignupReviews([student.id])[student.id] ?? checkingSignup;
  useEffect(() => {
    let cancelled = false;
    request<Review>(`/api/admin/students/${student.id}/registration-face`)
      .then(value => { if (!cancelled) setReview(value); })
      .catch(e => { if (!cancelled) setLoadError(apiMessage(e)); });
    return () => { cancelled = true; };
  }, [student.id]);
  const readiness = registrationReadiness({ attendanceMode: review?.attendanceMode ?? student.attendanceMode,
    faceReviewState: review?.state ?? student.faceReviewState }, signup);
  const ready = readiness.ready && review && (review.attendanceMode === 'MANUAL' || review.state === 'PENDING' && review.photos.length === 7);
  return <Modal size="wide" closeDisabled={busy} title={`Review ${student.fullName}`} titleId="registration-review-title" onClose={() => { if (!busy) onClose(); }}
    footer={<>
      <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn--primary" disabled={busy || !confirmed || !ready} onClick={onApprove}>{busy ? 'Approving…' : 'Approve registration'}</button>
    </>}>
    <div className="registration-review-body">
    <p>{student.studentNumber} · {student.universityEmail}</p>
    <p>Requested classes: {student.requestedClasses.join(', ')}</p>
    <p role="status">{signup.label}</p>
    {!readiness.ready && readiness.label !== signup.label && <p role="status">{readiness.label}</p>}
    {!review && !loadError && <p role="status">Loading registration review…</p>}
    {review?.attendanceMode === 'MANUAL' && <p>Manual attendance selected. No face photos are required.</p>}
    {review?.attendanceMode === 'FACE' && <>
      <p>Face attendance selected. Check all seven photos against the student's identity using your roster and an independent identity check.
        Image consistency is not proof of identity or live presence.</p>
      {review.state === 'EXPIRED' ? <p role="alert">The review photos expired. Ask the student to switch to manual attendance from their pending registration screen.</p> : <>
        <p>Photos available until {review.expiresAt && new Date(review.expiresAt).toLocaleString()}.</p>
        <div className="registration-face-captures">{review.photos.map((photo, i) => <figure key={i}><img src={photo} alt={`Registration capture ${i + 1}`} /></figure>)}</div>
      </>}
    </>}
    <label><input type="checkbox" checked={confirmed} disabled={busy || !ready} onChange={e => setConfirmed(e.target.checked)} />
      I verified this student's identity and requested classes{review?.attendanceMode === 'FACE' ? ', and reviewed all seven face captures' : ''}.</label>
    {(loadError || error) && <p role="alert">{loadError || error}</p>}
    </div>
  </Modal>;
}
