import { SelfProfileEditor } from '../../features/student-signup';
import { ConsentPanel } from '../../features/photo-attendance';
import type { AuthUser, Student } from '../../types';

export default function StudentProfileSettings({ user, profile }: { user: AuthUser; profile: Student | null }) {
  return <section className="student-profile-settings">
    <header><h1>Profile</h1><p>{profile?.name ?? user.name} · {profile?.email ?? user.email}</p></header>
    <SelfProfileEditor />
    <ConsentPanel studentId={user.id} />
  </section>;
}
