// RollCal's own addresses can't be used for an account: every @rollcal.app
// address lands in our support inbox, so an account on one fills it with
// codes and reset emails. Only the two app-review accounts are allowed.
// Kept in step with supabase/reserved-domain.sql, which refuses them on the
// server too.
const REVIEW_ACCOUNTS = ['apple-test@rollcal.app', 'google-test@rollcal.app'];

export const isReservedEmail = (email: string) => {
  const addr = email.trim().toLowerCase();
  return /@([a-z0-9-]+\.)*rollcal\.app$/.test(addr) && !REVIEW_ACCOUNTS.includes(addr);
};

export const RESERVED_EMAIL_ERROR = 'That address belongs to RollCal. Use your own email.';
