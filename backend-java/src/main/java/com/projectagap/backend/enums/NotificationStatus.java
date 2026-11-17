package com.projectagap.backend.enums;

/**
 * Dispatch status outcomes for system alerts.
 */
public enum NotificationStatus {
    SENT_SMS,           // Delivered via external SMS Gateway (Semaphore / Twilio)
    SKIPPED_GUEST,      // Withheld: User is an unverified guest (in-app tracker updated)
    FAILED_GATEWAY,     // SMS Gateway HTTP POST error
    ABORTED_NULL_USER   // Missing user profile record
}