// Length limits for what people type. supabase/join-modes.sql and
// payment-types.sql enforce the same numbers on the server, so keep them in
// step.

export const NAME_MAX = 30; // first name and last name, each
export const EVENT_TITLE_MAX = 60;
export const EVENT_LOCATION_MAX = 120;
export const EVENT_DESCRIPTION_MAX = 1000;
export const PAYMENT_NAME_MAX = 30; // the name someone gives an "Other" payment method
