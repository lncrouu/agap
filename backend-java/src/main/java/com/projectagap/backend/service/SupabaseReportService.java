package com.projectagap.backend.service;

import com.projectagap.backend.exception.BackendConfigurationException;
import com.projectagap.backend.exception.ReportValidationException;
import com.projectagap.backend.model.ReportSubmissionRequest;
import com.projectagap.backend.model.SupabaseReportPayload;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class SupabaseReportService {

    private final RestTemplate restTemplate;
    private final String supabaseUrl;
    private final String supabaseAnonKey;

    public SupabaseReportService(
            RestTemplate restTemplate,
            @Value("${agap.supabase.url:}") String supabaseUrl,
            @Value("${agap.supabase.anon-key:}") String supabaseAnonKey) {
        this.restTemplate = restTemplate;
        this.supabaseUrl = supabaseUrl;
        this.supabaseAnonKey = supabaseAnonKey;
    }

    public String submitReport(ReportSubmissionRequest request, String authorization) {
        validateConfiguration();
        if (request == null) {
            throw new ReportValidationException("Report submission is required.");
        }

        String ticketNo = firstNonBlank(request.ticketNo(), request.id());
        if (ticketNo == null) {
            throw new ReportValidationException("Ticket number is required.");
        }
        requireText(request.hazardType(), "Hazard or issue title is required.");
        requireText(request.location(), "Location is required.");
        requireText(request.deviceId(), "Device ID is required.");

        String proofPhotos = firstNonBlank(request.proofPhotos(), request.photos());
        requireText(proofPhotos, "At least one proof photo is required.");

        SupabaseReportPayload payload = new SupabaseReportPayload(
                firstNonBlank(request.id(), ticketNo),
                ticketNo,
                "",
                request.hazardType().trim(),
                request.severity(),
                request.location().trim(),
                request.coordinates(),
                request.description(),
                "PENDING",
                request.deviceId().trim(),
                proofPhotos,
                proofPhotos);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("apikey", supabaseAnonKey);
        headers.set(HttpHeaders.AUTHORIZATION, resolveAuthorization(authorization));
        headers.set("Prefer", "return=minimal");

        restTemplate.exchange(
                supabaseUrl + "/rest/v1/reports",
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                Void.class);

        return ticketNo;
    }

    private String resolveAuthorization(String authorization) {
        if (authorization == null || authorization.isBlank()) {
            return "Bearer " + supabaseAnonKey;
        }
        if (!authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new ReportValidationException("Authorization must use the Bearer scheme.");
        }
        return authorization;
    }

    private void validateConfiguration() {
        if (supabaseUrl.isBlank() || supabaseAnonKey.isBlank()) {
            throw new BackendConfigurationException(
                    "Supabase URL and anon key must be configured for the Java backend.");
        }
    }

    private static String firstNonBlank(String preferred, String fallback) {
        if (preferred != null && !preferred.isBlank()) {
            return preferred.trim();
        }
        if (fallback != null && !fallback.isBlank()) {
            return fallback.trim();
        }
        return null;
    }

    private static void requireText(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new ReportValidationException(message);
        }
    }
}
