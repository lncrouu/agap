import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { getVerificationResubmissionAt, validateResidentProfile } from '../utils/profileValidation';
import { getModerationRestriction } from '../utils/moderation';
import ActionDialog from '../components/ActionDialog';

export default function ProfileScreen({ onBack, onAdminLogin, onNavigate, userProfile }) {
  const [deviceId, setDeviceId] = useState('');
  const [profile, setProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [barangay, setBarangay] = useState('Brgy. Alangilan');
  const [idProofPhoto, setIdProofPhoto] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [profileClock, setProfileClock] = useState(Date.now());

  const verificationStatus = (profile?.verification_status || '').toUpperCase();
  const profileRestriction = getModerationRestriction(profile, profileClock);
  const verificationResubmissionAt = verificationStatus === 'REJECTED'
    ? getVerificationResubmissionAt(profile?.verification_rejected_at)
    : null;
  const isVerificationCooldownActive = verificationResubmissionAt
    ? verificationResubmissionAt.getTime() > profileClock
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
  }, [deviceId, userProfile]);

  useEffect(() => {
    if (verificationStatus !== 'REJECTED' && profileRestriction?.kind !== 'PENALIZED') return undefined;
    const timer = window.setInterval(() => setProfileClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [verificationStatus, profile?.verification_rejected_at, profileRestriction?.kind]);

  useEffect(() => {
    if (!isVerificationCooldownActive) return;
    setDialog({
      type: 'message',
      title: 'Verification cooldown',
      tone: 'warning',
      message: `Your verification request was rejected. You can submit another request after ${verificationResubmissionAt.toLocaleString()}.`
    });
  }, [verificationStatus, profile?.verification_rejected_at]);

  const showMessage = (message, tone = 'info', title) => {
    setDialog({ type: 'message', message, tone, title });
  };

  const closeDialog = () => setDialog(null);

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
        setBarangay(data.barangay || 'Brgy. Alangilan');
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

  const handleSaveProfile = async (e) => {
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

    const validation = validateResidentProfile({ username, fullName, phone, barangay, idProofPhoto });
    if (validation.error) {
      showMessage(validation.error, 'error', 'Check your verification details');
      return;
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
        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('device_id', deviceId);
        if (error) throw error;

        showMessage('Profile details saved. Your resident verification request is pending admin approval.', 'success', 'Profile saved');
        setProfile({ ...profile, ...payload });
        setIsEditing(false);
      } else {
        const profileId = 'USER-' + Math.floor(100000 + Math.random() * 900000);

        let insertPayload = {
          id: profileId,
          device_id: deviceId,
          ...validation.values,
          user_role: 'GUEST',
          verification_status: 'PENDING',
          id_proof_photo: idProofPhoto
        };

        const { error } = await supabase.from('profiles').insert([insertPayload]);
        if (error) throw error;

        showMessage('Details saved. You can continue using AGAP while your resident verification request is reviewed.', 'success', 'Profile saved');
        setProfile(insertPayload);
        setIsEditing(false);
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </button>
          <button
            type="button"
            style={styles.responderBtn}
            onClick={() => onNavigate && onNavigate('responder')}
          >
            Responder
          </button>
        </div>
      </div>

      <div style={styles.deviceBox}>
        <span style={styles.deviceLabel}>ACTIVE DEVICE FINGERPRINT:</span>
        <div style={styles.deviceVal}>{deviceId || 'Loading...'}</div>
      </div>

      <div style={styles.optionalVerificationNotice} role="note">
        <strong>Resident verification is optional.</strong> Guests and visitors can use AGAP without verifying an account. Verification is for Batangas residents who want an identity-checked resident profile. To request it, provide accurate details and a clear government ID or proof of Batangas residency for admin review.
      </div>

      {profile && !isEditing ? (
        <div style={styles.profileCard}>
          <div style={styles.statusRow}>
            <span style={profile.verification_status === 'VERIFIED' ? styles.badgeGreen : styles.badgeYellow}>
              {profile.verification_status === 'VERIFIED'
                ? 'VERIFIED BATANGAS CITIZEN'
                : verificationStatus === 'REJECTED'
                  ? 'VERIFICATION REJECTED'
                : `${profile.verification_status || 'GUEST'} - ADMIN REVIEW`}
            </span>
          </div>

          <h3 style={styles.userName}>Username: @{profile.username || 'User'}</h3>
          <div style={styles.userMeta}>Full Legal Name: {profile.full_name}</div>
          <div style={styles.userMeta}>Barangay Residency: {profile.barangay}</div>
          <div style={styles.userMeta}>Phone Number: {profile.phone || profile.phone_number || 'Not provided'}</div>
          {verificationStatus === 'REJECTED' && profile.moderation_message && (
            <div style={styles.rejectionReason}>
              <strong>Reason for rejection:</strong> {profile.moderation_message}
            </div>
          )}
          {profileRestriction?.kind === 'PENALIZED' && (
            <div style={styles.moderationNotice} role="alert">
              <strong>Report access is temporarily restricted.</strong>
              <div>{profileRestriction.message}</div>
            </div>
          )}

          <div style={styles.infoBanner}>
            Your details are active. You can report hazards and access emergency features.
          </div>

          {!isVerificationCooldownActive && (
            <button
              style={styles.editBtn}
              onClick={() => setIsEditing(true)}
            >
              Edit Profile Details
            </button>
          )}
        </div>
      ) : (
        <div style={styles.authCard}>
          <div style={styles.authHeaderRow}>
            <h3 style={styles.authTitle}>
              {profile ? 'Edit Profile Details' : 'Sign Up / Citizen Verification'}
            </h3>
            {profile && (
              <button style={styles.cancelBtn} onClick={() => setIsEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p style={styles.authSub}>
            {profile
              ? 'Submitting this form sends your resident verification details for admin review.'
              : 'Complete this form only if you are a Batangas resident requesting optional resident verification.'}
          </p>

          <form onSubmit={handleSaveProfile} style={styles.formStack} noValidate>
            <div>
              <label style={styles.inputLabel}>USERNAME (3-24 CHARACTERS)</label>
              <input
                type="text"
                style={styles.textInput}
                placeholder="e.g. BatangasUser01"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={24}
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label style={styles.inputLabel}>FULL LEGAL NAME</label>
              <input
                type="text"
                style={styles.textInput}
                placeholder="Enter complete legal name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                minLength={2}
                maxLength={80}
                autoComplete="name"
                required
              />
            </div>

            <div>
              <label style={styles.inputLabel}>MOBILE PHONE NUMBER</label>
              <input
                type="tel"
                style={styles.textInput}
                placeholder="0917 123 4567, 917 123 4567, or +63 917 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                required
              />
            </div>

            <div>
              <label style={styles.inputLabel}>BARANGAY RESIDENCY LOCATION</label>
              <input
                type="text"
                style={styles.textInput}
                placeholder="e.g. Brgy. Alangilan, Batangas City"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
                maxLength={80}
                required
              />
            </div>

            <div>
              <label style={styles.inputLabel}>
                {idProofPhoto
                  ? 'GOVERNMENT ID / BATANGAS RESIDENCY PROOF (ATTACHED; OPTIONAL TO REPLACE)'
                  : 'GOVERNMENT ID / BATANGAS RESIDENCY PROOF *'}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                style={styles.fileInput}
                required={!idProofPhoto}
              />
              <div style={styles.helperText}>
                A clear image is required for verification. If proof is already attached, you may keep it or upload a replacement.
              </div>
              {idProofPhoto && (
                <div style={styles.idPhotoPreview}>
                  <img src={idProofPhoto} alt="Uploaded identity proof preview" style={styles.idPhotoPreviewImage} />
                  <div style={styles.photoAttachedTag}>Identity photo attached</div>
                </div>
              )}
            </div>

            <button type="submit" style={styles.submitBtn} disabled={isSubmitting}>
              {isSubmitting ? 'Saving Changes...' : profile ? 'Save Updated Details' : 'Submit Details & Start Using AGAP'}
            </button>
          </form>
        </div>
      )}

      <ActionDialog dialog={dialog} onClose={closeDialog} />
    </div>
  );
}

const styles = {
  container: { maxWidth: '440px', margin: '0 auto', padding: '16px', fontFamily: "'Inter', sans-serif" },
  navHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' },
  headerText: { flex: 1, minWidth: 0 },
  headerActions: { display: 'flex', alignItems: 'center', gap: '6px' },
  adminLockBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', backgroundColor: '#F0FDF4', border: '1px solid #CCFBF1', borderRadius: '8px', color: '#0F766E', cursor: 'pointer' },
  responderBtn: { padding: '8px 10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' },
  backBtn: { backgroundColor: 'transparent', border: 'none', color: '#0F766E', fontSize: '13px', fontWeight: '700', cursor: 'pointer' },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#0F172A', margin: 0 },
  headerSub: { fontSize: '11px', color: '#64748B' },
  deviceBox: { backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '8px', padding: '10px', marginBottom: '14px' },
  deviceLabel: { fontSize: '9px', fontWeight: '800', color: '#64748B', display: 'block' },
  deviceVal: { fontSize: '12px', fontWeight: '800', color: '#0F766E', marginTop: '2px' },
  profileCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '16px' },
  statusRow: { marginBottom: '10px' },
  badgeGreen: { fontSize: '10px', fontWeight: '800', backgroundColor: '#DCFCE7', color: '#166534', padding: '4px 8px', borderRadius: '6px' },
  badgeYellow: { fontSize: '10px', fontWeight: '800', backgroundColor: '#FEF3C7', color: '#92400E', padding: '4px 8px', borderRadius: '6px' },
  userName: { fontSize: '16px', fontWeight: '800', color: '#0F172A', margin: '0 0 6px 0' },
  userMeta: { fontSize: '12px', color: '#475569', marginBottom: '4px' },
  infoBanner: { marginTop: '12px', backgroundColor: '#F0FDF4', border: '1px solid #A7F3D0', padding: '8px', borderRadius: '6px', fontSize: '11px', color: '#065F46', lineHeight: '1.4' },
  rejectionReason: { marginTop: '12px', padding: '10px 12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderLeft: '4px solid #DC2626', borderRadius: '8px', color: '#7F1D1D', fontSize: '12px', lineHeight: '1.5', overflowWrap: 'anywhere' },
  moderationNotice: { marginTop: '12px', padding: '10px 12px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderLeft: '4px solid #EA580C', borderRadius: '8px', color: '#7C2D12', fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-line', overflowWrap: 'anywhere' },
  optionalVerificationNotice: { marginBottom: '14px', padding: '10px 12px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', color: '#1E3A8A', fontSize: '11px', lineHeight: '1.5' },
  editBtn: { width: '100%', marginTop: '12px', padding: '10px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' },
  authCard: { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', padding: '16px' },
  authHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  authTitle: { fontSize: '15px', fontWeight: '800', color: '#0F172A', margin: '0 0 4px 0' },
  cancelBtn: { backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', color: '#64748B', cursor: 'pointer' },
  authSub: { fontSize: '11px', color: '#64748B', marginBottom: '12px', lineHeight: '1.4' },
  helperText: { marginTop: '5px', color: '#64748B', fontSize: '10px', lineHeight: '1.4' },
  formStack: { display: 'flex', flexDirection: 'column', gap: '10px' },
  inputLabel: { fontSize: '10px', fontWeight: '800', color: '#64748B', display: 'block', marginBottom: '4px' },
  textInput: { width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '12px', boxSizing: 'border-box' },
  fileInput: { fontSize: '11px' },
  photoAttachedTag: { fontSize: '10px', fontWeight: '800', color: '#15803D', marginTop: '4px' },
  idPhotoPreview: { marginTop: '8px', padding: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' },
  idPhotoPreviewImage: { display: 'block', maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', margin: '0 auto', borderRadius: '6px' },
  submitBtn: { width: '100%', padding: '11px', backgroundColor: '#0F766E', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', marginTop: '6px' },
};