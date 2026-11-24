package com.projectagap.backend.controller;

import com.projectagap.backend.exception.BackendConfigurationException;
import com.projectagap.backend.exception.ReportValidationException;
import com.projectagap.backend.model.ApiErrorResponse;
import com.projectagap.backend.model.ReportSubmissionRequest;
import com.projectagap.backend.model.ReportSubmissionResponse;
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

@RestController
@RequestMapping("/api/reports")
public class ReportSubmissionController {

    private final SupabaseReportService reportService;

    public ReportSubmissionController(SupabaseReportService reportService) {
        this.reportService = reportService;
    }

    @PostMapping
    public ResponseEntity<?> submitReport(
            @RequestBody ReportSubmissionRequest request,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        try {
            String ticketNo = reportService.submitReport(request, authorization);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(new ReportSubmissionResponse(true, ticketNo));
        } catch (ReportValidationException ex) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(false, ex.getMessage()));
        } catch (BackendConfigurationException ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(new ApiErrorResponse(false, ex.getMessage()));
        } catch (RestClientResponseException ex) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(new ApiErrorResponse(false, "Supabase rejected the report submission."));
        }
    }
}
