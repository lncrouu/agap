import { getEffectiveVerificationStatus, getModerationRestriction } from './moderation';

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
});
