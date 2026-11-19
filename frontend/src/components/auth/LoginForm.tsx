import type { FormEvent } from 'react';
import PasswordField from '../PasswordField';

interface Props {
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly password: string;
  readonly onPasswordChange: (value: string) => void;
  readonly showPassword: boolean;
  readonly onToggleShowPassword: () => void;
  readonly errorMessage: string;
  readonly busy: boolean;
  readonly onSubmit: (event: FormEvent) => void;
  readonly onSwitchToRegister: () => void;
  readonly onForgotPassword: () => void;
  readonly onBack?: () => void;
}

export default function LoginForm({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  showPassword,
  onToggleShowPassword,
  errorMessage,
  busy,
  onSubmit,
  onSwitchToRegister,
  onForgotPassword,
  onBack
}: Props) {
  return (
    <form className="auth-card" onSubmit={onSubmit} noValidate>
      {onBack && (
        <button type="button" className="auth-card__back" onClick={onBack}>
          ← Back to home
        </button>
      )}
      <h2 className="auth-card__title">Sign in</h2>
      <p className="auth-card__sub">Students can use their Student ID or login email. Staff use their email.</p>

      <div className="auth-form">
        <label className="field">
          <span>Student ID or email</span>
          <input
            type="text"
            autoComplete="username"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="Student ID or email"
          />
        </label>

        <PasswordField
          label="Password"
          value={password}
          onChange={onPasswordChange}
          show={showPassword}
          onToggleShow={onToggleShowPassword}
          autoComplete="current-password"
          placeholder="••••••••"
        />
        <button type="button" className="auth-card__back" onClick={onForgotPassword} disabled={busy}>Forgot password?</button>

        {errorMessage && <div className="form-error">{errorMessage}</div>}

        <button type="submit" className="btn btn--primary auth-form__submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </div>

      <div className="auth-card__switch">
        New here?{' '}
        <button type="button" onClick={onSwitchToRegister}>
          Create an account
        </button>
      </div>
    </form>
  );
}
