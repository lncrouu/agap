import { supabase } from '../supabaseClient';
import { getModerationRestriction } from '../utils/moderation';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

const isMissingModerationColumnError = (error) => {
  const message = (error?.message || '').toLowerCase();
  return ['42703', 'PGRST204'].includes(error?.code)
    || ((message.includes('moderation_message') || message.includes('penalty_until'))
      && (message.includes('column') || message.includes('schema cache') || message.includes('does not exist')));
};

const request = async (path, options = {}) => {
  if (!API_BASE_URL) {
    throw new Error('Java backend is not configured. Set REACT_APP_API_BASE_URL to enable it.');
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Backend request failed.');
  }

  return data;
};

export const submitHazardReport = async (reportData) => {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('verification_status')
    .eq('device_id', reportData.device_id)
    .maybeSingle();

  if (profileError) throw profileError;
  const status = (profile?.verification_status || '').trim().toUpperCase();
  let restriction = getModerationRestriction(profile);
  if (status === 'PENALIZED') {
    const { data: moderationData, error: moderationError } = await supabase
      .from('profiles')
      .select('moderation_message, penalty_until')
      .eq('device_id', reportData.device_id)
      .maybeSingle();

    if (moderationError) {
      if (isMissingModerationColumnError(moderationError)) {
        throw new Error('This device is penalized. Apply the Supabase moderation migration or have an administrator lift the penalty before submitting a report.');
      }
      throw moderationError;
    }

    restriction = getModerationRestriction({ ...profile, ...moderationData });
  }
  if (restriction) throw new Error(restriction.message);

  if (!API_BASE_URL) {
    const { error } = await supabase.from('reports').insert([reportData]);
    if (error) throw error;
    return { success: true, ticketNo: reportData.ticket_no };
  }

  return request('/reports', {
    method: 'POST',
    body: JSON.stringify(reportData),
  });
};

export const fetchReports = ({ status } = {}) => {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  const suffix = query.toString();
  return request(`/reports${suffix ? `?${suffix}` : ''}`);
};

export const requestGuestOtp = (phone) => request('/auth/send-otp', {
  method: 'POST',
  body: JSON.stringify({ phone }),
});