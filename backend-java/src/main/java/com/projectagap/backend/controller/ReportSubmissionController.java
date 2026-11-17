package com.projectagap.backend.controller;

import com.projectagap.backend.model.ReportSubmissionRequest;
import com.projectagap.backend.service.SupabaseReportService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientResponseException;

import java.util.Map;

@RestController
@RequestMapping("/api/reports")
public class ReportSubmissionController {

    private final SupabaseReportService reportService;

    public ReportSubmissionController(SupabaseReportService reportService) {
        this.reportService = reportService;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> submitReport(
            @RequestBody ReportSubmissionRequest request,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        try {
            String ticketNo = reportService.submitReport(request, authorization);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(Map.of("success", true, "ticketNo", ticketNo));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", ex.getMessage()));
        } catch (IllegalStateException ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("success", false, "error", ex.getMessage()));
        } catch (RestClientResponseException ex) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(Map.of("success", false, "error", "Supabase rejected the report submission."));
        }
    }
}
