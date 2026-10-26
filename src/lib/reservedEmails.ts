// RollCal's own mailboxes can't be used for an account: support@ is where
// people write to us, and confirm@ and no-reply@ send our email. Kept in step
// with supabase/reserved-emails.sql, which refuses them on the server too.
export const RESERVED_EMAILS = ['support@rollcal.app', 'confirm@rollcal.app', 'no-reply@rollcal.app'];

export const isReservedEmail = (email: string) =>
  RESERVED_EMAILS.includes(email.trim().toLowerCase());

export const RESERVED_EMAIL_ERROR = 'That address belongs to RollCal. Use your own email.';
