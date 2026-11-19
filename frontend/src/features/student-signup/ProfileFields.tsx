import { isMinor } from './profileFormModel';
import type { ProfileInput } from './profileApi';
import './self-profile.css';
export default function ProfileFields({ value, onChange, disabled = false, birthLocked = false, guardianLocked = false, requireBirth = true }: {
  value: ProfileInput; onChange: (value: ProfileInput) => void; disabled?: boolean; birthLocked?: boolean; guardianLocked?: boolean; requireBirth?: boolean;
}) {
  const minor = isMinor(value.dateOfBirth);
  const change = (key: keyof Omit<ProfileInput, 'guardian'>, text: string) => onChange({ ...value, [key]: text });
  return <fieldset className="signup-profile-fields" disabled={disabled}>
    <legend>Student details</legend>
    <div className="self-profile-grid">
      <label className="field">Date of birth<input type="date" required={requireBirth} value={value.dateOfBirth ?? ''}
        disabled={birthLocked} autoComplete="bday" onChange={event => change('dateOfBirth', event.target.value)} /></label>
      <label className="field">School name<input maxLength={160} value={value.schoolName}
        onChange={event => change('schoolName', event.target.value)} /></label>
      <label className="field">Student phone<input type="tel" maxLength={40} autoComplete="tel" value={value.phone}
        onChange={event => change('phone', event.target.value)} /></label>
      <label className="field">Student contact email (optional)<input type="email" maxLength={255} value={value.contactEmail}
        onChange={event => change('contactEmail', event.target.value)} /></label>
      <label className="field">Address<textarea maxLength={500} autoComplete="street-address" value={value.address}
        onChange={event => change('address', event.target.value)} /></label>
    </div>
    {birthLocked && <p>Contact the school to correct your name or date of birth.</p>}
    <label className="self-profile-check"><input type="checkbox" checked={!!value.guardian} disabled={guardianLocked || minor}
      onChange={event => onChange({ ...value, guardian: event.target.checked ? { name: '', relationship: '', email: '', phone: '' } : null })} />
      Add a parent or guardian {minor ? '(required for students under 18)' : '(optional)'}</label>
    {minor && !value.guardian && <button type="button" className="btn" onClick={() => onChange({
      ...value, guardian: { name: '', relationship: '', email: '', phone: '' },
    })}>Enter guardian details</button>}
    {value.guardian && <fieldset disabled={guardianLocked}>
      <legend>Parent or guardian</legend>
      <p>The guardian verifies their email and gives signup permission separately. The school confirms the relationship.
        This does not give permission for face processing, local camera analysis, observation sharing or live video.</p>
      <div className="self-profile-grid">{([
        ['name', 'Guardian name', 'text', 160], ['relationship', 'Relationship to student', 'text', 80],
        ['email', 'Guardian email', 'email', 255], ['phone', 'Guardian phone', 'tel', 40],
      ] as const).map(([key, label, type, maxLength]) => <label key={key} className="field">{label}
        <input required type={type} maxLength={maxLength} value={value.guardian![key]}
          onChange={event => onChange({ ...value, guardian: { ...value.guardian!, [key]: event.target.value } })} />
      </label>)}</div>
    </fieldset>}
    {guardianLocked && <p>Contact the school to change verified guardian details.</p>}
  </fieldset>;
}