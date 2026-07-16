import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Lock, ShieldCheck, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type SetupFormState = {
  username: string;
  password: string;
  confirmPassword: string;
};

const initialState: SetupFormState = {
  username: '',
  password: '',
  confirmPassword: '',
};

/**
 * Validates the account-setup form state.
 * Returns an i18n key + interpolation shape so the caller can resolve it
 * through the same translation pipeline as everything else on this screen.
 */
function validateSetupForm(
  formState: SetupFormState,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (!formState.username.trim() || !formState.password || !formState.confirmPassword) {
    return t('register.errors.allFieldsRequired');
  }

  if (formState.username.trim().length < 3) {
    return t('register.errors.usernameTooShort');
  }

  if (formState.password.length < 6) {
    return t('register.errors.passwordTooShort');
  }

  if (formState.password !== formState.confirmPassword) {
    return t('register.errors.passwordMismatch');
  }

  return null;
}

/**
 * Account setup / registration form.
 * Uses `autoComplete="new-password"` on password fields so password managers
 * recognise this as a registration flow and offer to save the new
 * credentials after submission. All user-facing strings are resolved from
 * the `auth` namespace so the form inherits the i18n language chosen by the
 * user (or the default — currently Spanish).
 */
export default function SetupForm() {
  const { t } = useTranslation('auth');
  const { register } = useAuth();

  const [formState, setFormState] = useState<SetupFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof SetupFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      const validationError = validateSetupForm(formState, t);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmitting(true);
      const result = await register(formState.username.trim(), formState.password);
      if (!result.success) {
        // The backend may return a plain error like "usernameTaken" — try to
        // resolve it through the same namespace so the user sees the
        // translated message. Fall back to the raw string otherwise.
        const key = `register.errors.${result.error}`;
        const translated = t(key, { defaultValue: '' });
        setErrorMessage(translated || result.error);
      }
      setIsSubmitting(false);
    },
    [formState, register, t],
  );

  return (
    <AuthScreenLayout
      title={t('register.title')}
      description={t('register.description')}
      footerText={t('register.footer')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          name="username"
          label={t('register.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('register.placeholders.username')}
          isDisabled={isSubmitting}
          autoComplete="username"
          icon={User}
        />

        <AuthInputField
          id="password"
          name="password"
          label={t('register.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('register.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
          icon={Lock}
        />

        <AuthInputField
          id="confirmPassword"
          name="confirmPassword"
          label={t('register.confirmPassword')}
          value={formState.confirmPassword}
          onChange={(value) => updateField('confirmPassword', value)}
          placeholder={t('register.placeholders.confirmPassword')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
          icon={ShieldCheck}
        />

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('register.hint')}
        </p>

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:brightness-110 hover:shadow-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('register.loading')}
            </>
          ) : (
            t('register.submit')
          )}
        </button>
      </form>
    </AuthScreenLayout>
  );
}