package com.projectagap.backend.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SupabaseReportPayload(
        String id,
        @JsonProperty("ticket_no") String ticketNo,
        String category,
        @JsonProperty("hazard_type") String hazardType,
        String severity,
        String location,
        String coordinates,
        String description,
        String status,
        @JsonProperty("device_id") String deviceId,
        @JsonProperty("proof_photos") String proofPhotos,
        String photos) {
}
