import {
  getVerificationResubmissionAt,
  normalizePhilippineMobileNumber,
  validateResidentProfile,
  VERIFICATION_COOLDOWN_MS
} from './profileValidation';

describe('resident profile validation', () => {
  const validProfile = {
    username: 'BatangasUser01',
    fullName: 'Maria Dela Cruz',
    phone: '0917 123 4567',
    barangay: 'Brgy. Alangilan',
    idProofPhoto: 'data:image/jpeg;base64,photo'
  };

  test('normalizes valid Philippine mobile formats to E.164', () => {
    expect(normalizePhilippineMobileNumber('09171234567')).toBe('+639171234567');
    expect(normalizePhilippineMobileNumber('9171234567')).toBe('+639171234567');
    expect(normalizePhilippineMobileNumber('+63 917 123 4567')).toBe('+639171234567');
    expect(normalizePhilippineMobileNumber('639171234567')).toBe('+639171234567');
  });

  test('accepts a complete resident request with proof', () => {
    const result = validateResidentProfile(validProfile);

    expect(result.error).toBeNull();
    expect(result.values.phone).toBe('+639171234567');
    expect(result.values.full_name).toBe('Maria Dela Cruz');
  });

  test.each([
    [{ ...validProfile, username: 'bad name' }, /Username/],
    [{ ...validProfile, fullName: 'Maria Cruz9' }, /full legal name/],
    [{ ...validProfile, phone: '12345' }, /Philippine mobile number/],
    [{ ...validProfile, idProofPhoto: '' }, /proof of Batangas residency/]
  ])('rejects invalid profile data', (profile, expectedError) => {
    expect(validateResidentProfile(profile).error).toMatch(expectedError);
  });

  test('calculates the next verification date as three days after rejection', () => {
    const rejectedAt = '2026-11-17T10:00:00.000Z';

    expect(getVerificationResubmissionAt(rejectedAt).getTime())
      .toBe(Date.parse(rejectedAt) + VERIFICATION_COOLDOWN_MS);
  });

  test('returns no cooldown date when the rejection timestamp is missing or invalid', () => {
    expect(getVerificationResubmissionAt(null)).toBeNull();
    expect(getVerificationResubmissionAt('not-a-date')).toBeNull();
  });
});
