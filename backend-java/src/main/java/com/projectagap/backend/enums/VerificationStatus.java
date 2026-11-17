package com.projectagap.backend.enums;

/**
 * Account verification states for Batangas residents and temporary guests.
 */
public enum VerificationStatus {
    GUEST,       // Temporary unverified user (tracked via device_id, max 3 reports, NO SMS)
    PENDING,     // Submitted ID proof for residency verification
    VERIFIED,    // Verified Citizen Resident (eligible for SMS alerts)
    PENALIZED,   // Restricted for false reporting
    BANNED       // Blocked hardware device
}