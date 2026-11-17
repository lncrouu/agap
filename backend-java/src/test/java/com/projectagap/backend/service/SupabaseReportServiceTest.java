package com.projectagap.backend.service;

import com.projectagap.backend.model.ReportSubmissionRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

class SupabaseReportServiceTest {

    @Test
    void submitReportPersistsAnIndividualPendingReportUsingAnonAuthorization() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        SupabaseReportService service = new SupabaseReportService(
                restTemplate,
                "https://agap-test.supabase.co",
                "anon-test-key");

        server.expect(requestTo("https://agap-test.supabase.co/rest/v1/reports"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("apikey", "anon-test-key"))
                .andExpect(header("Authorization", "Bearer anon-test-key"))
                .andExpect(jsonPath("$.category").value(""))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.proof_photos").value("[\"photo\"]"))
                .andRespond(withStatus(HttpStatus.CREATED));

        String ticketNo = service.submitReport(validRequest(), null);

        assertEquals("#AGAP-2026-0001", ticketNo);
        server.verify();
    }

    @Test
    void submitReportForwardsTheSignedInUsersBearerToken() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        SupabaseReportService service = new SupabaseReportService(
                restTemplate,
                "https://agap-test.supabase.co",
                "anon-test-key");

        server.expect(requestTo("https://agap-test.supabase.co/rest/v1/reports"))
                .andExpect(header("Authorization", "Bearer user-access-token"))
                .andRespond(withStatus(HttpStatus.CREATED));

        service.submitReport(validRequest(), "Bearer user-access-token");

        server.verify();
    }

    @Test
    void submitReportRejectsMissingEvidenceBeforeCallingSupabase() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
        SupabaseReportService service = new SupabaseReportService(
                restTemplate,
                "https://agap-test.supabase.co",
                "anon-test-key");
        ReportSubmissionRequest request = new ReportSubmissionRequest(
                "#AGAP-2026-0001",
                "#AGAP-2026-0001",
                "",
                "Flooding",
                "HIGH",
                "Rizal Avenue",
                "13.75,121.06",
                "Road flooding",
                "PENDING",
                "GUEST-1",
                null,
                null);

        assertThrows(IllegalArgumentException.class, () -> service.submitReport(request, null));
        server.verify();
    }

    private static ReportSubmissionRequest validRequest() {
        return new ReportSubmissionRequest(
                "#AGAP-2026-0001",
                "#AGAP-2026-0001",
                "Should be ignored",
                "Flooding",
                "HIGH",
                "Rizal Avenue",
                "13.75,121.06",
                "Road flooding",
                "RESOLVED",
                "GUEST-1",
                "[\"photo\"]",
                null);
    }
}
