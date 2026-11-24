import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import {
  getUsernameChangeAvailableAt,
  getVerificationResubmissionAt,
  validateResidentProfile,
  validateUsername
} from '../utils/profileValidation';
import ActionDialog from '../components/ActionDialog';

export default function ProfileScreen({ onBack, onAdminLogin, onNavigate, userProfile }) {
  const [deviceId, setDeviceId] = useState('');
  const [profile, setProfile] = useState(null);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isEditingVerification, setIsEditingVerification] = useState(false);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [barangay, setBarangay] = useState('');
  const [idProofPhoto, setIdProofPhoto] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [profileClock, setProfileClock] = useState(Date.now());

  const verificationStatus = (profile?.verification_status || '').toUpperCase();
  const verificationResubmissionAt = verificationStatus === 'REJECTED'
    ? getVerificationResubmissionAt(profile?.verification_rejected_at)
    : null;
  const usernameChangeAvailableAt = getUsernameChangeAvailableAt(profile?.username_updated_at);
  const isVerificationCooldownActive = verificationResubmissionAt
    ? verificationResubmissionAt.getTime() > profileClock
    : false;
  const isUsernameCooldownActive = usernameChangeAvailableAt
    ? usernameChangeAvailableAt.getTime() > profileClock
    : false;

  useEffect(() => {
    let localDeviceId = localStorage.getItem('agap_device_id');
    if (!localDeviceId) {
      localDeviceId = 'DEV-' + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem('agap_device_id', localDeviceId);
    }
    setDeviceId(localDeviceId);
    fetchProfile(localDeviceId);
  }, []);

  useEffect(() => {
    if (!userProfile || userProfile.device_id !== deviceId) return;
    setProfile(userProfile);
    setUsername(userProfile.username || '');
    setFullName(userProfile.full_name || '');
    setPhone(userProfile.phone || userProfile.phone_number || '');
    setBarangay(userProfile.barangay || '');
    setIdProofPhoto(userProfile.id_proof_photo || '');
  }, [deviceId, userProfile]);

  useEffect(() => {
    if (!isVerificationCooldownActive && !isUsernameCooldownActive) return undefined;
    const timer = window.setInterval(() => setProfileClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isVerificationCooldownActive, isUsernameCooldownActive]);

  const showMessage = (message, tone = 'info', title) => {
    setDialog({ type: 'message', message, tone, title });
  };

  const closeDialog = () => setDialog(null);

  const handleDialogConfirm = async () => {
    const action = dialog?.action;
    setDialog(null);
    if (action === 'save-username') await saveUsername();
    if (action === 'submit-verification') await submitVerification();
  };

  const fetchProfile = async (targetDeviceId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('device_id', targetDeviceId)
        .maybeSingle();

      if (data) {
        setProfile(data);
        setUsername(data.username || data.full_name || '');
        setFullName(data.full_name || '');
        setPhone(data.phone || data.phone_number || '');
        setBarangay(data.barangay || '');
        setIdProofPhoto(data.id_proof_photo || '');
      }
    } catch (err) {
      console.log('No profile recorded for device yet.');
    }
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showMessage('Choose an image file of your government ID or residency proof.', 'error', 'Invalid proof image');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showMessage('The selected proof image must be smaller than 10 MB.', 'error', 'Image is too large');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 800;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        if (!context) {
          showMessage('Unable to prepare the selected photo. Please choose another image.', 'error', 'Photo processing failed');
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setIdProofPhoto(canvas.toDataURL('image/jpeg', 0.75));
      };
      image.onerror = () => showMessage('Unable to read the selected photo. Please choose another image.', 'error', 'Photo could not be read');
      image.src = reader.result;
    };
    reader.onerror = () => showMessage('Unable to load the selected photo. Please choose another image.', 'error', 'Photo could not be loaded');
    reader.readAsDataURL(file);
  };

  const handleSaveUsername = (e) => {
    e.preventDefault();
    const validation = validateUsername(username);
    if (validation.error) return showMessage(validation.error, 'error', 'Check your username');
    if (validation.value === profile?.username) {
      setIsEditingUsername(false);
      return;
    }

    const availableAt = getUsernameChangeAvailableAt(profile?.username_updated_at);
    if (availableAt && availableAt.getTime() > Date.now()) {
      return showMessage(
        `You can change your username again after ${availableAt.toLocaleString()}.`,
        'warning',
        'Username change cooldown'
      );
    }

    setUsername(validation.value);
    setDialog({
      type: 'confirm',
      action: 'save-username',
      tone: 'warning',
      title: 'Confirm username change',
      message: `Change your username to @${validation.value}? After confirming, you can change it again in 7 days.`
    });
  };

  const saveUsername = async () => {
    if (!deviceId || !profile) {
      return showMessage('Your profile is still loading. Please try again in a moment.', 'error', 'Unable to save username');
    }
    const validation = validateUsername(username);
    if (validation.error) return showMessage(validation.error, 'error', 'Check your username');
    const availableAt = getUsernameChangeAvailableAt(profile.username_updated_at);
    if (availableAt && availableAt.getTime() > Date.now()) {
      return showMessage(
        `You can change your username again after ${availableAt.toLocaleString()}.`,
        'warning',
        'Username change cooldown'
      );
    }

    setIsSavingUsername(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ username: validation.value })
        .eq('device_id', deviceId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('The username was not saved. Refresh your profile and try again.');
      setProfile(data);
      setUsername(data.username || '');
      setIsEditingUsername(false);
      showMessage(
        `Your username is now @${data.username}. You can change it again after ${getUsernameChangeAvailableAt(data.username_updated_at)?.toLocaleString() || '7 days'}.`,
        'success',
        'Username updated'
      );
    } catch (err) {
      showMessage(`Username update failed: ${err.message}`, 'error', 'Unable to save username');
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleSaveProfile = (e) => {
    e.preventDefault();
    const currentResubmissionAt = verificationStatus === 'REJECTED'
      ? getVerificationResubmissionAt(profile?.verification_rejected_at)
      : null;
    if (currentResubmissionAt && currentResubmissionAt.getTime() > Date.now()) {
      showMessage(
        `Your verification request was rejected. You can resubmit after ${currentResubmissionAt.toLocaleString()}.`,
        'warning',
        'Verification cooldown'
      );
      return;
    }

    const validation = validateResidentProfile({ fullName, phone, barangay, idProofPhoto });
    if (validation.error) {
      showMessage(validation.error, 'error', 'Check your verification details');
      return;
    }
    setDialog({
      type: 'confirm',
      action: 'submit-verification',
      tone: 'warning',
      title: 'Submit resident verification?',
      message: 'Please confirm that your legal name, phone number, barangay, and proof photo are accurate. Your request will be sent to an administrator for review.'
    });
  };

  const submitVerification = async () => {
    const currentResubmissionAt = verificationStatus === 'REJECTED'
      ? getVerificationResubmissionAt(profile?.verification_rejected_at)
      : null;
    if (currentResubmissionAt && currentResubmissionAt.getTime() > Date.now()) {
      return showMessage(
        `Your verification request was rejected. You can resubmit after ${currentResubmissionAt.toLocaleString()}.`,
        'warning',
        'Verification cooldown'
      );
    }

    const validation = validateResidentProfile({ fullName, phone, barangay, idProofPhoto });
    if (validation.error) {
      return showMessage(validation.error, 'error', 'Check your verification details');
    }
    setIsSubmitting(true);

    try {
      const payload = {
        ...validation.values,
        verification_status: profile && ['PENALIZED', 'BANNED'].includes((profile.verification_status || '').toUpperCase())
          ? profile.verification_status
          : 'PENDING',
        id_proof_photo: idProofPhoto,
        ...(verificationStatus === 'REJECTED' ? { moderation_message: null } : {})
      };

      if (profile) {
        const { data, error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('device_id', deviceId)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Your verification request was not saved. Refresh your profile and try again.');

        setProfile(data);
        showMessage('Your verification request is submitted. You can continue using AGAP while an administrator reviews it.', 'success', 'Request submitted');
        setIsEditingVerification(false);
      } else {
        const profileId = 'USER-' + Math.floor(100000 + Math.random() * 900000);

        const insertPayload = {
          id: profileId,
          device_id: deviceId,
          ...validation.values,
          username: `Guest_${deviceId.replace('DEV-', '')}`,
          user_role: 'GUEST',
          verification_status: 'PENDING',
          id_proof_photo: idProofPhoto
        };

        const { data, error } = await supabase
          .from('profiles')
          .insert([insertPayload])
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Your verification request was not saved. Please try again.');

        setProfile(data);
        setUsername(data.username || '');
        showMessage('Your verification request is submitted. You can continue using AGAP while an administrator reviews it.', 'success', 'Request submitted');
        setIsEditingVerification(false);
      }
    } catch (err) {
      showMessage(`Save failed: ${err.message}`, 'error', 'Unable to save profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.navHeader}>
        <button style={styles.backBtn} onClick={onBack}>
          &lt; Back
        </button>
        <div style={styles.headerText}>
          <h2 style={styles.headerTitle}>User Identity & Verification</h2>
          <div style={styles.headerSub}>Project AGAP Resident Registration</div>
        </div>
        <div style={styles.headerActions}>
          <button
            type="button"
            style={styles.adminLockBtn}
            onClick={onAdminLogin}
            title="Admin sign in"
            aria-label="Admin sign in"
          >
            <img src={`${process.env.PUBLIC_URL}/icons/admin.svg`} alt="" width="22" height="22" />
          </button>
          <button
            type="button"
            style={styles.responderBtn}
            onClick={() => onNavigate && onNavigate('responder')}
          >
            <img src={`${process.env.PUBLIC_URL}/icons/responder.svg`} alt="" width="16" height="16" />
            Responder
          </button>
        </div>
      </div>

      <div style={styles.deviceBox}>
        <span style={styles.deviceLabel}>ACTIVE DEVICE FINGERPRINT:</span>
        <div style={styles.deviceVal}>{deviceId || 'Loading...'}</div>
      </div>

      {profile && (
        <section style={styles.profileCard}>
          <div style={styles.profileOverviewHeader}>
            <div>
              <span style={styles.sectionEyebrow}>YOUR ACCOUNT</span>
              <h3 style={styles.profileName}>{profile.full_name || 'Resident profile'}</h3>
            </div>
            <span style={verificationStatus === 'VERIFIED' ? styles.badgeGreen : verificationStatus === 'REJECTED' ? styles.badgeRed : styles.badgeYellow}>
              {verificationStatus.replace(/_/g, ' ') || 'GUEST'}
            </span>
          </div>
          <div style={styles.profileDetailsGrid}>
            <div style={styles.profileDetail}>
              <span style={styles.detailLabel}>Phone number</span>
              <span style={styles.detailValue}>{profile.phone || profile.phone_number || 'Not provided'}</span>
            </div>
            <div style={styles.profileDetail}>
              <span style={styles.detailLabel}>Barangay</span>
              <span style={styles.detailValue}>{profile.barangay || 'Not provided'}</span>
            </div>
            <div style={styles.profileDetail}>
              <span style={styles.detailLabel}>Device ID</span>
              <span style={styles.detailValue}>{deviceId || 'Loading...'}</span>
            </div>
          </div>
          {verificationStatus === 'REJECTED' && profile.moderation_message && (
            <div style={styles.rejectionReason}>
              <strong>Review note</strong>
              <span>{profile.moderation_message}</span>
            </div>
          )}
        </section>
      )}

      <section style={styles.usernameCard}>
        <div style={styles.sectionHeader}>
          <div>
            <span style={styles.sectionEyebrow}>PERSONAL PREFERENCE</span>
            <h3 style={styles.sectionTitle}>Username</h3>
          </div>
          {!isEditingUsername && profile && !isUsernameCooldownActive && (
            <button type="button" style={styles.secondaryButton} onClick={() => setIsEditingUsername(true)}>
              Edit username
            </button>
          )}
        </div>
        {isEditingUsername ? (
          <form onSubmit={handleSaveUsername} style={styles.formStack} noValidate>
            <label htmlFor="profile-username" style={styles.inputLabel}>USERNAME (3-24 CHARACTERS)</label>
            <input
              id="profile-username"
              type="text"
              style={styles.textInput}
              placeholder="e.g. BatangasUser01"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={3}
              maxLength={24}
              autoComplete="username"
              required
              disabled={isSavingUsername}
            />
            <div style={styles.helperText}>You can change your username once every 7 days.</div>
            <div style={styles.buttonRow}>
              <button
                type="button"
                style={styles.cancelBtn}
                onClick={() => {
                  setUsername(profile?.username || '');
                  setIsEditingUsername(false);
                }}
                disabled={isSavingUsername}
              >
                Cancel
              </button>
              <button type="submit" style={styles.submitBtn} disabled={isSavingUsername}>
                {isSavingUsername ? 'Saving...' : 'Save username'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div style={styles.usernameValue}>@{profile?.username || username || 'Guest'}</div>
            <div style={styles.helperText}>
              {isUsernameCooldownActive
                ? `You can edit your username again after ${usernameChangeAvailableAt.toLocaleString()}.`
                : 'Choose a name that will appear on your profile.'}
            </div>
          </>
        )}
      </section>

      <section style={styles.authCard}>
        <div style={styles.sectionEyebrow}>BATANGAS RESIDENTS</div>
        <h3 style={styles.sectionTitle}>Resident verification</h3>
        <p style={styles.authSub}>
          Verification is optional. Submit your legal details and proof of residency for administrator review. You can use AGAP while your request is being reviewed.
        </p>

        {verificationStatus === 'PENDING' ? (
          <div style={styles.pendingNotice} role="status">
            <strong>Request submitted — waiting for admin approval</strong>
            <span>Your details are in the review queue. You can continue using AGAP while you wait.</span>
          </div>
        ) : isVerificationCooldownActive ? (
          <div style={styles.cooldownNotice} role="status">
            <strong>Another request will be available after 24 hours</strong>
            <span>You can submit a new verification request after {verificationResubmissionAt.toLocaleString()}.</span>
          </div>
        ) : isEditingVerification || !profile ? (
          <>
            <div style={styles.formHeader}>
              <h4 style={styles.formTitle}>{profile ? 'Verification details' : 'Start resident verification'}</h4>
              {profile && (
                <button
                  type="button"
                  style={styles.cancelBtn}
                  onClick={() => {
                    setIsEditingVerification(false);
                    setFullName(profile.full_name || '');
                    setPhone(profile.phone || profile.phone_number || '');
                    setBarangay(profile.barangay || '');
                    setIdProofPhoto(profile.id_proof_photo || '');
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            <form onSubmit={handleSaveProfile} style={styles.formStack} noValidate>
              <div>
                <label style={styles.inputLabel}>FULL LEGAL NAME *</label>
                <input
                  type="text"
                  style={styles.textInput}
                  placeholder="Enter complete legal name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  required
                />
              </div>

              <div>
                <label style={styles.inputLabel}>MOBILE PHONE NUMBER *</label>
                <input
                  type="tel"
                  style={styles.textInput}
                  placeholder="0917 123 4567 or +63 917 123 4567"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
              </div>

              <div>
                <label style={styles.inputLabel}>BARANGAY RESIDENCY LOCATION *</label>
                <input
                  type="text"
                  style={styles.textInput}
                  placeholder="e.g. Brgy. Alangilan, Batangas City"
                  value={barangay}
                  onChange={(event) => setBarangay(event.target.value)}
                  maxLength={80}
                  required
                />
              </div>

              <div style={styles.proofSection}>
                <label style={styles.inputLabel}>GOVERNMENT ID / RESIDENCY PROOF *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  style={styles.fileInput}
                  required={!idProofPhoto}
                />
                <div style={styles.helperText}>Attach a clear image. You may keep an existing photo or upload a replacement.</div>
                {idProofPhoto ? (
                  <div style={styles.idPhotoPreview}>
                    <img src={idProofPhoto} alt="Uploaded identity proof preview" style={styles.idPhotoPreviewImage} />
                    <div style={styles.photoAttachedTag}>Proof photo attached</div>
                  </div>
                ) : (
                  <div style={styles.photoMissing}>A proof photo is required before submitting.</div>
                )}
              </div>

              <button type="submit" style={styles.submitBtn} disabled={isSubmitting}>
                {isSubmitting ? 'Submitting request...' : 'Review and submit'}
              </button>
            </form>
          </>
        ) : (
          <div style={styles.verificationAction}>
            {verificationStatus === 'VERIFIED' ? (
              <div style={styles.verifiedNotice}>
                Your resident details are verified. If your information needs updating, you can send it for review again.
              </div>
            ) : (
              <div style={styles.guestNotice}>
                Guests can use AGAP without verification. Submit a request if you would like a resident profile.
              </div>
            )}
            <button type="button" style={styles.submitBtn} onClick={() => setIsEditingVerification(true)}>
              {verificationStatus === 'VERIFIED' ? 'Update verification details' : 'Request resident verification'}
            </button>
          </div>
        )}
      </section>

      <ActionDialog dialog={dialog} onClose={closeDialog} onConfirm={handleDialogConfirm} />
    </div>
  );
}

const styles = {
  container: { maxWidth: '440px', margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', fontFamily: "'Inter', sans-serif", boxSizing: 'border-box' },
  navHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' },
  headerText: { flex: 1, minWidth: 0 },
  headerActions: { display: 'flex', alignItems: 'center', gap: '6px' },
  adminLockBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', backgroundColor: '#F0FDF4', border: '1px solid #CCFBF1', borderRadius: '8px', color: '#0F766E', cursor: 'pointer' },
  responderBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  backBtn: { backgroundColor: 'transparent', border: 'none', color: '#0F766E', fontSize: '13px', fontWeight: '700', cursor: 'pointer' },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#0F172A', margin: 0 },
  headerSub: { fontSize: '11px', color: '#64748B' },
  deviceBox: { backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '11px 13px' },
  deviceLabel: { fontSize: '9px', fontWeight: '800', color: '#64748B', display: 'block' },
  deviceVal: { fontSize: '12px', fontWeight: '800', color: '#0F766E', marginTop: '2px' },
  profileCard: { padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', boxShadow: '0 4px 14px rgba(15, 23, 42, 0.04)' },
  profileOverviewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '14px' },
  sectionEyebrow: { color: '#0F766E', fontSize: '9px', fontWeight: '800', letterSpacing: '0.8px' },
  profileName: { margin: '4px 0 0', color: '#0F172A', fontSize: '17px', fontWeight: '800', overflowWrap: 'anywhere' },
  badgeGreen: { flexShrink: 0, fontSize: '9px', fontWeight: '800', backgroundColor: '#DCFCE7', color: '#166534', padding: '5px 8px', borderRadius: '6px' },
  badgeYellow: { flexShrink: 0, fontSize: '9px', fontWeight: '800', backgroundColor: '#FEF3C7', color: '#92400E', padding: '5px 8px', borderRadius: '6px' },
  badgeRed: { flexShrink: 0, fontSize: '9px', fontWeight: '800', backgroundColor: '#FEE2E2', color: '#991B1B', padding: '5px 8px', borderRadius: '6px' },
  profileDetailsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  profileDetail: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 },
  detailLabel: { color: '#64748B', fontSize: '10px', fontWeight: '700' },
  detailValue: { color: '#0F172A', fontSize: '12px', lineHeight: '1.4', overflowWrap: 'anywhere' },
  rejectionReason: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '14px', padding: '10px 12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderLeft: '4px solid #DC2626', borderRadius: '8px', color: '#7F1D1D', fontSize: '11px', lineHeight: '1.5', overflowWrap: 'anywhere' },
  usernameCard: { padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', boxShadow: '0 4px 14px rgba(15, 23, 42, 0.04)' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '10px' },
  sectionTitle: { margin: '3px 0 0', color: '#0F172A', fontSize: '15px', fontWeight: '800' },
  usernameValue: { marginTop: '6px', color: '#0F766E', fontSize: '20px', fontWeight: '800', overflowWrap: 'anywhere' },
  secondaryButton: { padding: '8px 10px', backgroundColor: '#F0FDF4', border: '1px solid #CCFBF1', borderRadius: '7px', color: '#0F766E', fontSize: '10px', fontWeight: '800', cursor: 'pointer' },
  authCard: { padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', boxShadow: '0 4px 14px rgba(15, 23, 42, 0.04)' },
  authSub: { margin: '7px 0 14px', color: '#64748B', fontSize: '11px', lineHeight: '1.5' },
  formHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  formTitle: { margin: 0, color: '#0F172A', fontSize: '12px', fontWeight: '800' },
  cancelBtn: { padding: '7px 10px', backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '7px', color: '#475569', fontSize: '10px', fontWeight: '700', cursor: 'pointer' },
  buttonRow: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' },
  helperText: { marginTop: '5px', color: '#64748B', fontSize: '10px', lineHeight: '1.4' },
  pendingNotice: { display: 'flex', flexDirection: 'column', gap: '5px', padding: '12px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderLeft: '4px solid #2563EB', borderRadius: '9px', color: '#1E3A8A', fontSize: '11px', lineHeight: '1.5' },
  cooldownNotice: { display: 'flex', flexDirection: 'column', gap: '5px', padding: '12px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderLeft: '4px solid #EA580C', borderRadius: '9px', color: '#7C2D12', fontSize: '11px', lineHeight: '1.5' },
  verifiedNotice: { marginBottom: '10px', padding: '10px', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', color: '#166534', fontSize: '11px', lineHeight: '1.5' },
  guestNotice: { marginBottom: '10px', padding: '10px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', color: '#475569', fontSize: '11px', lineHeight: '1.5' },
  verificationAction: { display: 'flex', flexDirection: 'column' },
  proofSection: { padding: '11px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '9px' },
  photoMissing: { marginTop: '8px', color: '#B91C1C', fontSize: '10px', fontWeight: '700' },
  formStack: { display: 'flex', flexDirection: 'column', gap: '10px' },
  inputLabel: { fontSize: '10px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '4px' },
  textInput: { width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' },
  fileInput: { fontSize: '11px' },
  photoAttachedTag: { fontSize: '10px', fontWeight: '800', color: '#15803D', marginTop: '4px' },
  idPhotoPreview: { marginTop: '8px', padding: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' },
  idPhotoPreviewImage: { display: 'block', maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', margin: '0 auto', borderRadius: '6px' },
  submitBtn: { width: '100%', padding: '11px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', marginTop: '6px' },
};