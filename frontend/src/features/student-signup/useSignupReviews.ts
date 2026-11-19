import { useEffect, useState } from 'react';
import { getSignupReview } from './profileApi';
import { signupReviewStatus, unavailableSignup, type SignupReviewStatus } from './signupReviewModel';

/** Reuse the scoped review API without changing the pending-list contract. Bound fan-out to four. */
export function useSignupReviews(ids: string[], revision = 0): Record<string, SignupReviewStatus> {
  const key = JSON.stringify([ids, revision]);
  const [snapshot, setSnapshot] = useState<{ key: string; statuses: Record<string, SignupReviewStatus> }>({ key: '', statuses: {} });
  useEffect(() => {
    let cancelled = false;
    const [requestedIds] = JSON.parse(key) as [string[], number];
    let next = 0;
    setSnapshot({ key, statuses: {} });
    const worker = async () => {
      while (!cancelled && next < requestedIds.length) {
        const id = requestedIds[next++];
        let status: SignupReviewStatus;
        try { status = signupReviewStatus(await getSignupReview(id)); }
        catch { status = unavailableSignup; }
        if (!cancelled) setSnapshot(current => current.key === key
          ? { key, statuses: { ...current.statuses, [id]: status } } : current);
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, requestedIds.length) }, worker));
    return () => { cancelled = true; };
  }, [key]);
  return snapshot.key === key ? snapshot.statuses : {};
}
