import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Support tickets: saved in support_tickets and emailed to
// support@rollcal.app by the support-email function (supabase/support.sql),
// which sets their account email as the reply-to.

export type SupportCategory = 'account' | 'problem' | 'pro' | 'other';

export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string; hint: string }[] = [
  { value: 'account', label: 'Change something on my account', hint: 'Your email, your name, or deleting data' },
  { value: 'problem', label: 'Something isn’t working', hint: 'A bug, a crash, or something that looks wrong' },
  { value: 'pro', label: 'Plans and subscriptions', hint: 'Your plan, an Event Pass or a paid feature' },
  { value: 'other', label: 'Something else', hint: 'Questions, ideas, anything' },
];

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;

// "#C7EA6E60": what people can quote when they follow up.
export const ticketRef = (id: string) => `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export async function sendSupportTicket(
  userId: string,
  category: SupportCategory,
  message: string
): Promise<{ ref: string } | { error: string }> {
  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: userId,
      category,
      message: message.trim(),
      // Helps with problems; nothing personal.
      app_info: {
        platform: Platform.OS,
        os: String(Platform.Version),
        version: Constants.expoConfig?.version ?? 'unknown',
      },
    })
    .select('id')
    .single();
  if (error || !data) {
    // The database's own wording for the daily limit is written for people.
    if (error?.code === '42501' && /messages today/.test(error.message)) return { error: error.message };
    return { error: 'Couldn’t send that. Check your connection and try again.' };
  }
  return { ref: ticketRef(data.id) };
}
