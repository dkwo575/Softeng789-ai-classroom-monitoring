import { lazy, Suspense, useState } from 'react';
const Student = lazy(() => import('./StudentLiveVideo'));
export { default as TeacherLiveVideo } from './TeacherLiveVideo';
export function StudentLiveVideoEntry({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  return <div style={{ margin: '20px 0' }}><button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close live video sharing' : 'Open live video sharing'}</button>
    {open && <Suspense fallback={<p>Loading live video…</p>}><Student studentId={studentId} /></Suspense>}</div>;
}
