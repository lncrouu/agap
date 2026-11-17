package com.projectagap.backend.controller;

import com.projectagap.backend.enums.NotificationStatus;
import com.projectagap.backend.enums.VerificationStatus;
import com.projectagap.backend.model.IncidentReport;
import com.projectagap.backend.model.UserProfile;
import com.projectagap.backend.service.ReportNotificationService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * REST Controller exposing API endpoints for the React frontend (frontend-js).
 * Handles report notifications, triage updates, and responder dispatch alerts.
 */
@RestController
@RequestMapping("/api/reports")
@CrossOrigin(origins = "http://localhost:3000") // Connects with React Frontend
public class ReportController {

    private final ReportNotificationService notificationService;

    public ReportController(ReportNotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * Endpoint to dispatch status update notifications to citizens.
     * POST /api/reports/notify
     */
    @PostMapping("/notify")
    public ResponseEntity<Map<String, Object>> dispatchReportNotification(@RequestBody Map<String, Object> requestPayload) {
        Map<String, Object> response = new HashMap<>();

        // Extract payload parameters sent from React frontend
        String deviceId = (String) requestPayload.get("deviceId");
        String ticketNo = (String) requestPayload.get("ticketNo");
        String phoneNumber = (String) requestPayload.get("phoneNumber");
        String verificationStatusStr = (String) requestPayload.getOrDefault("verificationStatus", "GUEST");
        String messageText = (String) requestPayload.getOrDefault("messageText", "Project AGAP Emergency Update");

        // Construct UserProfile domain entity
        UserProfile user = new UserProfile();
        user.setDeviceId(deviceId);
        user.setPhoneNumber(phoneNumber);
        if ("VERIFIED".equalsIgnoreCase(verificationStatusStr)) {
            user.setVerificationStatus(VerificationStatus.VERIFIED);
        } else {
            user.setVerificationStatus(VerificationStatus.GUEST);
        }

        // Construct IncidentReport domain entity
        IncidentReport report = new IncidentReport();
        report.setTicketNo(ticketNo);

        // Execute notification routing business rule
        NotificationStatus outcome = notificationService.dispatchNotification(user, report, messageText);

        // Build API response payload
        response.put("ticketNo", ticketNo);
        response.put("deviceId", deviceId);
        response.put("outcome", outcome.name());
        response.put("timestamp", LocalDateTime.now().toString());

        if (outcome == NotificationStatus.SENT_SMS) {
            response.put("success", true);
            response.put("message", "📱 Real-time SMS alert delivered to Verified Citizen (+63" + phoneNumber + ").");
        } else if (outcome == NotificationStatus.SKIPPED_GUEST) {
            response.put("success", true);
            response.put("message", "ℹ️ SMS Skipped: Guest Device unverified. In-app tracker timeline updated.");
        } else {
            response.put("success", false);
            response.put("message", "⚠️ Notification outcome: " + outcome.name());
        }

        return ResponseEntity.ok(response);
    }
}