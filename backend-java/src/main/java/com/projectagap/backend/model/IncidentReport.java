package com.projectagap.backend.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class IncidentReport {
    private String ticketNo;
    private String category;
    private String hazardType;
    private String description;
    private String severity;
    private String location;
    private String coordinates;
    private String deviceId;
    private String senderName;
    private List<String> proofPhotos;
    private String status; // PENDING, UNDER_INVESTIGATION, APPROVED, DISPATCHED, IN_PROGRESS, RESOLVED, REJECTED
    private String assignedResponder;
    private String dispatchNotes;
    private LocalDateTime createdAt;

    public IncidentReport() {
        this.proofPhotos = new ArrayList<>();
        this.status = "PENDING";
        this.createdAt = LocalDateTime.now();
    }

    // Getters and Setters
    public String getTicketNo() { return ticketNo; }
    public void setTicketNo(String ticketNo) { this.ticketNo = ticketNo; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getHazardType() { return hazardType; }
    public void setHazardType(String hazardType) { this.hazardType = hazardType; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getSeverity() { return severity; }
    public void setSeverity(String severity) { this.severity = severity; }

    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }

    public String getCoordinates() { return coordinates; }
    public void setCoordinates(String coordinates) { this.coordinates = coordinates; }

    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }

    public String getSenderName() { return senderName; }
    public void setSenderName(String senderName) { this.senderName = senderName; }

    public List<String> getProofPhotos() { return proofPhotos; }
    public void setProofPhotos(List<String> proofPhotos) { this.proofPhotos = proofPhotos; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getAssignedResponder() { return assignedResponder; }
    public void setAssignedResponder(String assignedResponder) { this.assignedResponder = assignedResponder; }

    public String getDispatchNotes() { return dispatchNotes; }
    public void setDispatchNotes(String dispatchNotes) { this.dispatchNotes = dispatchNotes; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}