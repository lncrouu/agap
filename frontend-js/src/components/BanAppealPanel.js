import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import ActionDialog from './ActionDialog';

const MIN_APPEAL_LENGTH = 30;
const MAX_APPEAL_LENGTH = 2000;

export default function BanAppealPanel({ userProfile }) {
  const [message, setMessage] = useState('');
  const [appeal, setAppeal] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    if (!userProfile?.ban_appeal) return;
    setAppeal({
      message: userProfile.ban_appeal,
      status: userProfile.ban_appeal_status,
      submittedAt: userProfile.ban_appeal_submitted_at,
      response: userProfile.ban_appeal_response
    });
  }, [
    userProfile?.ban_appeal,
    userProfile?.ban_appeal_status,
    userProfile?.ban_appeal_submitted_at,
    userProfile?.ban_appeal_response
  ]);

  const currentAppeal = appeal || (userProfile?.ban_appeal ? {
    message: userProfile.ban_appeal,
    status: userProfile.ban_appeal_status,
    submittedAt: userProfile.ban_appeal_submitted_at,
    response: userProfile.ban_appeal_response
  } : null);
  const isPending = (currentAppeal?.status || '').toUpperCase() === 'PENDING';
  const isApproved = (currentAppeal?.status || '').toUpperCase() === 'APPROVED';

  const handleSubmit = async (event) => {
    event.preventDefault();
    const appealMessage = message.trim();
    if (appealMessage.length < MIN_APPEAL_LENGTH) {
      setDialog({
        type: 'message',
        tone: 'warning',
        title: 'Add more detail',
        message: `Please provide at least ${MIN_APPEAL_LENGTH} characters so the review team can understand your appeal.`
      });
      return;
    }
    if (appealMessage.length > MAX_APPEAL_LENGTH) {
      setDialog({
        type: 'message',
        tone: 'warning',
        title: 'Appeal is too long',
        message: `Keep your appeal under ${MAX_APPEAL_LENGTH} characters.`
      });
      return;
    }
    if (!userProfile?.device_id) {
      setDialog({
        type: 'message',
        tone: 'error',
        title: 'Unable to send appeal',
        message: 'This device is missing its account identifier. Please contact the support team.'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          ban_appeal: appealMessage,
          ban_appeal_status: 'PENDING'
        })
        .eq('device_id', userProfile.device_id)
        .eq('verification_status', 'BANNED')
        .select('device_id, ban_appeal, ban_appeal_status, ban_appeal_submitted_at, ban_appeal_response')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error('This device is no longer eligible to submit an appeal. Refresh the app and try again.');
      }

      setAppeal({
        message: data.ban_appeal,
        status: data.ban_appeal_status,
        submittedAt: data.ban_appeal_submitted_at,
        response: data.ban_appeal_response
      });
      setMessage('');
      setDialog({
        type: 'message',
        tone: 'success',
        title: 'Appeal received',
        message: 'Your appeal has been sent to the CDRRMO review team. The ban remains active while your appeal is under review.'
      });
    } catch (error) {
      setDialog({
        type: 'message',
        tone: 'error',
        title: 'Appeal could not be sent',
        message: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section style={styles.card} aria-labelledby="ban-appeal-title">
      <div style={styles.header}>
        <div style={styles.icon} aria-hidden="true">?</div>
        <div>
          <div style={styles.eyebrow}>REQUEST A REVIEW</div>
          <h2 id="ban-appeal-title" style={styles.title}>Submit a ban appeal</h2>
        </div>
      </div>
      <p style={styles.description}>
        If you believe this restriction was applied in error, explain what happened and include any relevant ticket references. The review team will examine your appeal.
      </p>

      {currentAppeal && (
        <div style={isPending ? styles.pendingNotice : isApproved ? styles.approvedNotice : styles.deniedNotice} role="status">
          <strong>
            {isPending ? 'Appeal under review' : isApproved ? 'Appeal approved' : 'Previous appeal reviewed'}
          </strong>
          {currentAppeal.submittedAt && (
            <span>Submitted {new Date(currentAppeal.submittedAt).toLocaleString()}</span>
          )}
          {currentAppeal.response && <span>{currentAppeal.response}</span>}
        </div>
      )}

      {!isPending && !isApproved && (
        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          <label htmlFor="ban-appeal-message" style={styles.label}>YOUR APPEAL</label>
          <textarea
            id="ban-appeal-message"
            style={styles.textarea}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe why you are appealing this ban. Please be respectful and specific."
            rows={5}
            minLength={MIN_APPEAL_LENGTH}
            maxLength={MAX_APPEAL_LENGTH}
            required
            disabled={isSubmitting}
          />
          <div style={styles.formFooter}>
            <span style={styles.helperText}>At least {MIN_APPEAL_LENGTH} characters</span>
            <span style={styles.counter}>{message.length}/{MAX_APPEAL_LENGTH}</span>
          </div>
          <button type="submit" style={isSubmitting ? styles.submitDisabled : styles.submit} disabled={isSubmitting}>
            {isSubmitting ? 'Sending appeal...' : 'Send appeal for review'}
          </button>
        </form>
      )}

      {isPending && (
        <div style={styles.submittedMessage}>
          Your appeal was received. You can submit another appeal if this one is denied.
        </div>
      )}
      <p style={styles.footer}>
        Sending an appeal does not immediately restore access. Your device stays restricted until an administrator changes its status.
      </p>
      <ActionDialog dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}

const styles = {
  card: { width: '100%', maxWidth: '440px', boxSizing: 'border-box', marginTop: '22px', padding: '18px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)', textAlign: 'left' },
  header: { display: 'flex', alignItems: 'center', gap: '11px' },
  icon: { width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: '11px', backgroundColor: '#FFF7ED', color: '#B45309', fontSize: '22px', fontWeight: '800' },
  eyebrow: { color: '#B45309', fontSize: '9px', fontWeight: '800', letterSpacing: '0.8px' },
  title: { margin: '3px 0 0', color: '#0F172A', fontSize: '16px', fontWeight: '800' },
  description: { margin: '12px 0 14px', color: '#475569', fontSize: '12px', lineHeight: '1.55' },
  form: { display: 'flex', flexDirection: 'column', gap: '7px' },
  label: { color: '#475569', fontSize: '10px', fontWeight: '800', letterSpacing: '0.4px' },
  textarea: { width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '11px', border: '1px solid #CBD5E1', borderRadius: '8px', color: '#0F172A', fontSize: '12px', lineHeight: '1.5', fontFamily: 'inherit' },
  formFooter: { display: 'flex', justifyContent: 'space-between', gap: '8px' },
  helperText: { color: '#64748B', fontSize: '10px' },
  counter: { color: '#64748B', fontSize: '10px' },
  submit: { width: '100%', marginTop: '5px', padding: '11px 14px', border: 'none', borderRadius: '8px', backgroundColor: '#0F766E', color: '#FFFFFF', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  submitDisabled: { width: '100%', marginTop: '5px', padding: '11px 14px', border: 'none', borderRadius: '8px', backgroundColor: '#94A3B8', color: '#FFFFFF', fontSize: '12px', fontWeight: '800', cursor: 'wait' },
  pendingNotice: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '12px 0', padding: '11px', border: '1px solid #FED7AA', borderLeft: '4px solid #EA580C', borderRadius: '8px', backgroundColor: '#FFF7ED', color: '#7C2D12', fontSize: '11px', lineHeight: '1.5' },
  approvedNotice: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '12px 0', padding: '11px', border: '1px solid #BBF7D0', borderLeft: '4px solid #16A34A', borderRadius: '8px', backgroundColor: '#F0FDF4', color: '#166534', fontSize: '11px', lineHeight: '1.5' },
  deniedNotice: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '12px 0', padding: '11px', border: '1px solid #FECACA', borderLeft: '4px solid #DC2626', borderRadius: '8px', backgroundColor: '#FEF2F2', color: '#7F1D1D', fontSize: '11px', lineHeight: '1.5' },
  submittedMessage: { marginTop: '10px', color: '#475569', fontSize: '11px', lineHeight: '1.5' },
  footer: { margin: '13px 0 0', color: '#64748B', fontSize: '10px', lineHeight: '1.45' }
};
