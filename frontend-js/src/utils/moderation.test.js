import {
  getEffectiveVerificationStatus,
  getModerationRestriction,
  isGuestDeviceProfile,
  isPendingVerificationRequest
} from './moderation';

describe('moderation restrictions', () => {
  test('bans block all use regardless of penalty expiry', () => {
    const restriction = getModerationRestriction({
      verification_status: 'BANNED',
      moderation_message: 'Repeated false reports.'
    });

    expect(restriction.kind).toBe('BANNED');
    expect(restriction.message).toContain('Repeated false reports.');
  });

  test('active penalties block report submission and expired penalties restore prior status', () => {
    const profile = {
      verification_status: 'PENALIZED',
      moderation_previous_status: 'VERIFIED',
      penalty_until: '2026-11-18T00:00:00.000Z'
    };

    expect(getModerationRestriction(profile, Date.parse('2026-11-17T00:00:00.000Z')).kind).toBe('PENALIZED');
    expect(getModerationRestriction(profile, Date.parse('2026-11-19T00:00:00.000Z'))).toBeNull();
    expect(getEffectiveVerificationStatus(profile, Date.parse('2026-11-19T00:00:00.000Z'))).toBe('VERIFIED');
  });

  test('a penalty without an end date stays blocked until lifted', () => {
    expect(getModerationRestriction({ verification_status: 'PENALIZED' }).kind).toBe('PENALIZED');
  });

  test('unverified devices remain guests while their verification request is pending or rejected', () => {
    expect(isGuestDeviceProfile({ verification_status: 'GUEST' })).toBe(true);
    expect(isGuestDeviceProfile({ verification_status: 'PENDING' })).toBe(true);
    expect(isGuestDeviceProfile({ verification_status: 'REJECTED' })).toBe(true);
    expect(isGuestDeviceProfile({ verification_status: 'VERIFIED' })).toBe(false);
  });

  test('only pending unmoderated profiles appear in the verification queue', () => {
    expect(isPendingVerificationRequest({ verification_status: 'PENDING' })).toBe(true);
    expect(isPendingVerificationRequest({ verification_status: 'REJECTED' })).toBe(false);
    expect(isPendingVerificationRequest({ verification_status: 'GUEST' })).toBe(false);
    expect(isPendingVerificationRequest({ verification_status: 'PENALIZED' })).toBe(false);
  });
});
