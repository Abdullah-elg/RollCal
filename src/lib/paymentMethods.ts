// A user's saved payment handles (for example e-transfer or Venmo) that bills
// show to the people who owe them. Only one can be the default, so changing
// the default takes two steps in a set order. Also re-exports paymentHandles.

import { PaymentMethod, PaymentMethodType } from './paymentHandles';
import { supabase } from './supabase';

export * from './paymentHandles';

type Result = { error: string | null };

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const DUPLICATE_ERROR = 'You already saved that one.';

export async function listPaymentMethods(
  userId: string
): Promise<{ methods: PaymentMethod[]; error: string | null }> {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return { methods: [], error: GENERIC_ERROR };
  return { methods: (data ?? []) as PaymentMethod[], error: null };
}

async function hasDuplicate(
  userId: string,
  type: PaymentMethodType,
  handle: string,
  exceptId?: string
): Promise<boolean> {
  let query = supabase
    .from('payment_methods')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('handle', handle);
  if (exceptId) query = query.neq('id', exceptId);
  const { data } = await query.limit(1);
  return (data?.length ?? 0) > 0;
}

export async function addPaymentMethod(
  userId: string,
  type: PaymentMethodType,
  handle: string,
  makeDefault: boolean
): Promise<Result> {
  if (await hasDuplicate(userId, type, handle)) return { error: DUPLICATE_ERROR };

  const { count } = await supabase
    .from('payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  const isFirst = (count ?? 0) === 0;

  // Insert as a non-default first: the one-default index would reject it
  // while another default exists, so a wanted default goes through the swap.
  const { data, error } = await supabase
    .from('payment_methods')
    .insert({ user_id: userId, type, handle, is_default: isFirst })
    .select('id')
    .single();
  if (error || !data) {
    return { error: error?.code === '23505' ? DUPLICATE_ERROR : GENERIC_ERROR };
  }
  if (makeDefault && !isFirst) return setDefaultPaymentMethod(userId, data.id);
  return { error: null };
}

export async function updatePaymentMethod(id: string, handle: string): Promise<Result> {
  const { data: row } = await supabase
    .from('payment_methods')
    .select('user_id, type')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { error: GENERIC_ERROR };
  if (await hasDuplicate(row.user_id, row.type, handle, id)) {
    return { error: DUPLICATE_ERROR };
  }
  const { error } = await supabase.from('payment_methods').update({ handle }).eq('id', id);
  if (error) return { error: error.code === '23505' ? DUPLICATE_ERROR : GENERIC_ERROR };
  return { error: null };
}

// Two steps, in this order: the unique index allows only one default per user.
export async function setDefaultPaymentMethod(userId: string, id: string): Promise<Result> {
  const { error: clearError } = await supabase
    .from('payment_methods')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true);
  if (clearError) return { error: GENERIC_ERROR };
  const { error } = await supabase
    .from('payment_methods')
    .update({ is_default: true })
    .eq('id', id)
    .eq('user_id', userId);
  return { error: error ? GENERIC_ERROR : null };
}

export async function removePaymentMethod(userId: string, id: string): Promise<Result> {
  const { data: row } = await supabase
    .from('payment_methods')
    .select('is_default')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  const { error } = await supabase
    .from('payment_methods')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) return { error: GENERIC_ERROR };
  if (!row?.is_default) return { error: null };

  const { data: next } = await supabase
    .from('payment_methods')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (next && next.length > 0) return setDefaultPaymentMethod(userId, next[0].id);
  return { error: null };
}
