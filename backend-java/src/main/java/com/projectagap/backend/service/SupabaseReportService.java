package com.projectagap.backend.service;

import com.projectagap.backend.model.ReportSubmissionRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;

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
            throw new IllegalArgumentException("Report submission is required.");
        }

        String ticketNo = firstNonBlank(request.ticketNo(), request.id());
        if (ticketNo == null) {
            throw new IllegalArgumentException("Ticket number is required.");
        }
        requireText(request.hazardType(), "Hazard or issue title is required.");
        requireText(request.location(), "Location is required.");
        requireText(request.deviceId(), "Device ID is required.");

        String proofPhotos = firstNonBlank(request.proofPhotos(), request.photos());
        requireText(proofPhotos, "At least one proof photo is required.");

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", firstNonBlank(request.id(), ticketNo));
        row.put("ticket_no", ticketNo);
        row.put("category", "");
        row.put("hazard_type", request.hazardType().trim());
        row.put("severity", request.severity());
        row.put("location", request.location().trim());
        row.put("coordinates", request.coordinates());
        row.put("description", request.description());
        row.put("status", "PENDING");
        row.put("device_id", request.deviceId().trim());
        row.put("proof_photos", proofPhotos);
        row.put("photos", proofPhotos);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("apikey", supabaseAnonKey);
        headers.set(HttpHeaders.AUTHORIZATION, resolveAuthorization(authorization));
        headers.set("Prefer", "return=minimal");

        restTemplate.exchange(
                supabaseUrl + "/rest/v1/reports",
                HttpMethod.POST,
                new HttpEntity<>(row, headers),
                Void.class);

        return ticketNo;
    }

    private String resolveAuthorization(String authorization) {
        if (authorization == null || authorization.isBlank()) {
            return "Bearer " + supabaseAnonKey;
        }
        if (!authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new IllegalArgumentException("Authorization must use the Bearer scheme.");
        }
        return authorization;
    }

    private void validateConfiguration() {
        if (supabaseUrl.isBlank() || supabaseAnonKey.isBlank()) {
            throw new IllegalStateException("Supabase URL and anon key must be configured for the Java backend.");
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
            throw new IllegalArgumentException(message);
        }
    }
}
