package com.projectagap.backend.client;

/**
 * Interface contract for SMS Gateway API communication (Semaphore / Twilio).
 */
public interface SmsGatewayClient {
    /**
     * Transmits an SMS message to a mobile recipient (+63 format).
     *
     * @param phoneNumber  Recipient phone number
     * @param messageText  Message content
     * @return true if HTTP POST returned 200 OK
     */
    boolean sendSms(String phoneNumber, String messageText);
}