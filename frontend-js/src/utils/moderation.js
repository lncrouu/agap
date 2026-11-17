export function getModerationRestriction(profile, now = Date.now()) {
  const status = (profile?.verification_status || '').trim().toUpperCase();
  const customMessage = (profile?.moderation_message || '').trim();

  if (status === 'BANNED') {
    return {
      kind: 'BANNED',
      message: [
        'This device is banned from using Project AGAP. Access will remain restricted until an administrator lifts the ban.',
        customMessage
      ].filter(Boolean).join('\n\n')
    };
  }

  if (status !== 'PENALIZED') return null;

  const penaltyEnd = profile?.penalty_until ? Date.parse(profile.penalty_until) : NaN;
  if (Number.isFinite(penaltyEnd) && penaltyEnd <= now) return null;

  const endText = Number.isFinite(penaltyEnd)
    ? `Report submissions are paused until ${new Date(penaltyEnd).toLocaleString()}.`
    : 'Report submissions are paused until an administrator sets an end date or lifts the penalty.';

  return {
    kind: 'PENALIZED',
    penaltyUntil: Number.isFinite(penaltyEnd) ? new Date(penaltyEnd).toISOString() : null,
    message: [
      endText,
      customMessage
    ].filter(Boolean).join('\n\n')
  };
}

export function getEffectiveVerificationStatus(profile, now = Date.now()) {
  const status = (profile?.verification_status || 'GUEST').trim().toUpperCase();
  if (status === 'PENALIZED' && !getModerationRestriction(profile, now)) {
    return (profile?.moderation_previous_status || 'GUEST').trim().toUpperCase();
  }
  return status;
}
