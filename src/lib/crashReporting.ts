// Crash and error reports, through Sentry. Off until EXPO_PUBLIC_SENTRY_DSN
// is set (in .env for local builds, in the EAS environment for store
// builds), so nothing is sent from a build that doesn't have it.
//
// Reports carry what went wrong, the app version and the phone's model and
// system version. No names, emails, messages or photos (sendDefaultPii off),
// as the privacy policy says.

import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const crashReportingOn = !!dsn;

export function startCrashReporting(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Development builds report to the console instead.
    enabled: !__DEV__,
    tracesSampleRate: 0,
  });
}

// For errors the app handles but should still hear about, like a phone that
// can't get a push token.
export function reportError(err: unknown, context?: string): void {
  if (!dsn) return;
  Sentry.captureException(err, context ? { tags: { where: context } } : undefined);
}

export const wrapRoot = Sentry.wrap;
