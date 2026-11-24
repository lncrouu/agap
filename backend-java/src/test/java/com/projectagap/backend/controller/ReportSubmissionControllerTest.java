package com.projectagap.backend.controller;

import com.projectagap.backend.exception.BackendConfigurationException;
import com.projectagap.backend.exception.ReportValidationException;
import com.projectagap.backend.model.ReportSubmissionRequest;
import com.projectagap.backend.service.SupabaseReportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.HttpClientErrorException;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

class ReportSubmissionControllerTest {

    private SupabaseReportService reportService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reportService = mock(SupabaseReportService.class);
        mockMvc = standaloneSetup(new ReportSubmissionController(reportService)).build();
    }

    @Test
    void submitReportReturnsTheExistingSuccessResponseShape() throws Exception {
        when(reportService.submitReport(any(ReportSubmissionRequest.class), isNull()))
                .thenReturn("#AGAP-2026-0001");

        mockMvc.perform(post("/api/reports")
                        .contentType("application/json")
                        .content("""
                                {
                                  "id": "#AGAP-2026-0001",
                                  "ticket_no": "#AGAP-2026-0001",
                                  "hazard_type": "Flooding",
                                  "severity": "HIGH",
                                  "location": "Rizal Avenue",
                                  "device_id": "GUEST-1",
                                  "proof_photos": "[\\"photo\\"]"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.ticketNo").value("#AGAP-2026-0001"));
    }

    @Test
    void submitReportKeepsValidationErrorsAsBadRequests() throws Exception {
        when(reportService.submitReport(any(ReportSubmissionRequest.class), isNull()))
                .thenThrow(new ReportValidationException("Location is required."));

        mockMvc.perform(post("/api/reports")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value("Location is required."));
    }

    @Test
    void submitReportKeepsConfigurationErrorsAsServiceUnavailable() throws Exception {
        when(reportService.submitReport(any(ReportSubmissionRequest.class), isNull()))
                .thenThrow(new BackendConfigurationException("Backend is not configured."));

        mockMvc.perform(post("/api/reports")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error").value("Backend is not configured."));
    }

    @Test
    void submitReportKeepsSupabaseRejectionsAsBadGateway() throws Exception {
        when(reportService.submitReport(any(ReportSubmissionRequest.class), isNull()))
                .thenThrow(HttpClientErrorException.create(
                        HttpStatus.BAD_REQUEST, "Rejected", null, null, null));

        mockMvc.perform(post("/api/reports")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error")
                        .value("Supabase rejected the report submission."));
    }
}
