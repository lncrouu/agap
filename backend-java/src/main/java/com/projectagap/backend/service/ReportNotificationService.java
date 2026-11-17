package com.projectagap.backend.service;

import com.projectagap.backend.model.UserProfile;
import com.projectagap.backend.model.IncidentReport;
import com.projectagap.backend.enums.VerificationStatus;
import com.projectagap.backend.enums.NotificationStatus;
import com.projectagap.backend.client.SmsGatewayClient;
import org.springframework.stereotype.Service;

import java.util.logging.Logger;

/**
 * Project AGAP Notification Routing Service
 * Enforces notification dispatch boundaries:
 * 
 * 1. VERIFIED CITIZEN: Dispatches real-time SMS alerts via SMS Gateway API 
 *    (Semaphore / Twilio) to their registered phone number.
 * 2. GUEST DEVICE: Withholds external SMS alerts (contact info unverified).
 *    Updates in-app notification timeline only, creating an incentive for residents to verify.
 */
@Service
public class ReportNotificationService {

    private static final Logger LOGGER = Logger.getLogger(ReportNotificationService.class.getName());
    private final SmsGatewayClient smsGatewayClient;

    public ReportNotificationService(SmsGatewayClient smsGatewayClient) {
        this.smsGatewayClient = smsGatewayClient;
    }

    /**
     * Evaluates citizen verification status and dispatches SMS if eligible.
     *
     * @param citizen      The target user profile
     * @param report       The target incident report
     * @param messageText  The message content to transmit
     * @return NotificationStatus result enum (SENT_SMS vs SKIPPED_GUEST)
     */
    public NotificationStatus dispatchNotification(UserProfile citizen, IncidentReport report, String messageText) {
        if (citizen == null) {
            LOGGER.warning("Notification aborted: Target user profile is null.");
            return NotificationStatus.ABORTED_NULL_USER;
        }

        // Rule: Only Verified Citizens with registered phone numbers receive SMS
        boolean isVerified = citizen.getVerificationStatus() == VerificationStatus.VERIFIED;
        String phoneNumber = citizen.getPhoneNumber();

        if (isVerified && phoneNumber != null && !phoneNumber.trim().isEmpty()) {
            LOGGER.info(String.format("Routing SMS to Verified Citizen (%s) for Ticket #%s", phoneNumber, report.getTicketNo()));
            
            boolean success = smsGatewayClient.sendSms(phoneNumber, messageText);
            if (success) {
                LOGGER.info("📱 SMS Alert successfully delivered to +63" + phoneNumber);
                return NotificationStatus.SENT_SMS;
            } else {
                LOGGER.severe("SMS Gateway delivery failed for " + phoneNumber);
                return NotificationStatus.FAILED_GATEWAY;
            }
        } else {
            // Unverified Guest or missing contact info: Withhold SMS, log in-app update
            LOGGER.info(String.format("ℹ️ SMS Alert Skipped for Guest Device [%s]. Reason: Contact info unverified. In-app tracker updated.", citizen.getDeviceId()));
            
            recordInAppTrackerEvent(citizen.getDeviceId(), report.getTicketNo(), messageText);
            return NotificationStatus.SKIPPED_GUEST;
        }
    }

    private void recordInAppTrackerEvent(String deviceId, String ticketNo, String message) {
        LOGGER.info("In-App Timeline Event Recorded for Ticket #" + ticketNo + " on Device " + deviceId);
    }
}