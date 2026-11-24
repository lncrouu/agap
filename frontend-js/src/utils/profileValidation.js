const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._]{1,22}[A-Za-z0-9])$/;
const FULL_NAME_PATTERN = /^[\p{L}][\p{L} .'-]*[\p{L}.]$/u;
export const VERIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function getVerificationResubmissionAt(rejectedAt) {
  if (!rejectedAt) return null;
  const timestamp = Date.parse(rejectedAt);
  return Number.isNaN(timestamp) ? null : new Date(timestamp + VERIFICATION_COOLDOWN_MS);
}

export function getUsernameChangeAvailableAt(usernameUpdatedAt) {
  if (!usernameUpdatedAt) return null;
  const timestamp = Date.parse(usernameUpdatedAt);
  return Number.isNaN(timestamp) ? null : new Date(timestamp + USERNAME_COOLDOWN_MS);
}

export function validateUsername(username) {
  const cleanUsername = String(username || '').trim();
  if (!USERNAME_PATTERN.test(cleanUsername)) {
    return { error: 'Username must be 3-24 characters, start and end with a letter or number, and use only letters, numbers, dots, or underscores.' };
  }
  return { error: null, value: cleanUsername };
}

export function normalizePhilippineMobileNumber(value) {
  const compact = String(value || '').trim().replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  if (/^9\d{9}$/.test(compact)) return `+63${compact}`;
  if (/^639\d{9}$/.test(compact)) return `+${compact}`;
  if (/^\+639\d{9}$/.test(compact)) return compact;
  return null;
}

export function validateResidentProfile({ fullName, phone, barangay, idProofPhoto }) {
  const cleanFullName = String(fullName || '').trim().replace(/\s+/g, ' ');
  const letterCount = (cleanFullName.match(/\p{L}/gu) || []).length;
  if (cleanFullName.length < 2 || cleanFullName.length > 80 || !FULL_NAME_PATTERN.test(cleanFullName) || letterCount < 2) {
    return { error: 'Enter a valid full legal name using letters, spaces, apostrophes, periods, or hyphens.' };
  }

  const normalizedPhone = normalizePhilippineMobileNumber(phone);
  if (!normalizedPhone) {
    return { error: 'Enter a valid Philippine mobile number, such as 09171234567, 9171234567, or +639171234567.' };
  }

  const cleanBarangay = String(barangay || '').trim().replace(/\s+/g, ' ');
  if (cleanBarangay.length < 2 || cleanBarangay.length > 80 || !/\p{L}/u.test(cleanBarangay) || /[\u0000-\u001F]/.test(cleanBarangay)) {
    return { error: 'Enter a valid barangay or residency location (2-80 characters).' };
  }

  if (!idProofPhoto) {
    return { error: 'A clear government ID or proof of Batangas residency is required for resident verification.' };
  }

  return {
    error: null,
    values: {
      full_name: cleanFullName,
      phone: normalizedPhone,
      barangay: cleanBarangay
    }
  };
}
