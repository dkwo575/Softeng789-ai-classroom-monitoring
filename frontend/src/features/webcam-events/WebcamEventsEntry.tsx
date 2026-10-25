import { lazy, Suspense, useState } from 'react';
const Panel = lazy(() => import('./WebcamEventsPanel'));

// No camera or model initialization until the user explicitly starts the local test.
export default function WebcamEventsEntry({ studentId }: { studentId?: string }) {
  const [open, setOpen] = useState(false);
  return <div style={{ margin: '20px 0' }}>
    <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Close webcam movement test' : 'Open webcam movement test'}
    </button>
    {open && <Suspense fallback={<p role="status">Loading camera test…</p>}><Panel studentId={studentId} /></Suspense>}
  </div>;
}
