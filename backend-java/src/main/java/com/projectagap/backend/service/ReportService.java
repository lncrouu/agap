
package com.projectagap.backend.service;

import com.projectagap.backend.enums.VerificationStatus;
import com.projectagap.backend.model.IncidentReport;
import com.projectagap.backend.model.UserProfile;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.Year;
import java.util.Locale;
import java.util.UUID;

@Service
public class ReportService {

    public IncidentReport prepareSubmission(IncidentReport report, UserProfile submitter) {
        if (report == null) {
            throw new IllegalArgumentException("Incident report is required.");
        }
        if (submitter == null) {
            throw new IllegalArgumentException("Submitter profile is required.");
        }
        if (submitter.hasReachedGuestLimit()) {
            throw new IllegalStateException("Guest limit reached: maximum 3 hazard submissions per device.");
        }

        if (submitter.getVerificationStatus() == VerificationStatus.GUEST) {
            submitter.setSubmissionCount(submitter.getSubmissionCount() + 1);
        }

        String ticketNo = report.getTicketNo();
        if (ticketNo == null || ticketNo.isBlank()) {
            String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
            report.setTicketNo("AGAP-" + Year.now().getValue() + "-" + suffix);
        }

        report.setStatus("PENDING");
        report.setDeviceId(submitter.getDeviceId());
        if (report.getCreatedAt() == null) {
            report.setCreatedAt(LocalDateTime.now());
        }

        return report;
    }
}
