import React from 'react';

export default function ActionDialog({ dialog, onClose, onConfirm }) {
  if (!dialog) return null;

  const tone = dialog.tone || 'info';
  const toneColor = tone === 'error'
    ? '#B91C1C'
    : tone === 'success'
      ? '#15803D'
      : tone === 'warning'
        ? '#B45309'
        : '#0F766E';

  return (
    <div style={styles.overlay}>
      <div
        role={dialog.type === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="action-dialog-title"
        style={{ ...styles.card, borderTopColor: toneColor }}
      >
        <h2 id="action-dialog-title" style={{ ...styles.title, color: toneColor }}>
          {dialog.title || (dialog.type === 'confirm' ? 'Confirm action' : 'Notice')}
        </h2>
        <p style={styles.message}>{dialog.message}</p>
        <div style={styles.actions}>
          {dialog.type === 'confirm' ? (
            <>
              <button type="button" style={styles.cancelButton} onClick={onClose}>Cancel</button>
              <button
                type="button"
                style={{ ...styles.confirmButton, backgroundColor: toneColor }}
                onClick={onConfirm}
              >
                Confirm
              </button>
            </>
          ) : (
            <button type="button" style={{ ...styles.confirmButton, backgroundColor: toneColor }} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backgroundColor: 'rgba(15, 118, 110, 0.18)' },
  card: { width: '100%', maxWidth: '380px', boxSizing: 'border-box', backgroundColor: '#FFFFFF', border: '1px solid #D1D5DB', borderTop: '5px solid #0F766E', borderRadius: '12px', padding: '20px', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)' },
  title: { margin: '0 0 8px', fontSize: '16px', fontWeight: '600' },
  message: { margin: '0', color: '#334155', fontSize: '14px', lineHeight: '1.55', whiteSpace: 'pre-line', overflowWrap: 'anywhere' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' },
  cancelButton: { padding: '9px 14px', backgroundColor: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  confirmButton: { minWidth: '84px', padding: '9px 14px', color: '#FFFFFF', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }
};
