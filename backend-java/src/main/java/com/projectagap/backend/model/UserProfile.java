package com.projectagap.backend.model;

import com.projectagap.backend.enums.VerificationStatus;
import java.time.LocalDateTime;

public class UserProfile {
    private String deviceId;
    private String username;
    private String fullName;
    private String phoneNumber;
    private String barangay;
    private VerificationStatus verificationStatus;
    private String idProofPhoto;
    private int submissionCount;
    private LocalDateTime createdAt;

    public UserProfile() {
        this.verificationStatus = VerificationStatus.GUEST;
        this.submissionCount = 0;
        this.createdAt = LocalDateTime.now();
    }

    public UserProfile(String deviceId, String username, String fullName, String phoneNumber, String barangay, VerificationStatus verificationStatus) {
        this.deviceId = deviceId;
        this.username = username;
        this.fullName = fullName;
        this.phoneNumber = phoneNumber;
        this.barangay = barangay;
        this.verificationStatus = verificationStatus != null ? verificationStatus : VerificationStatus.GUEST;
        this.submissionCount = 0;
        this.createdAt = LocalDateTime.now();
    }

    // Business Rule: Checks if an unverified guest has reached the 3-report limit
    public boolean hasReachedGuestLimit() {
        return this.verificationStatus == VerificationStatus.GUEST && this.submissionCount >= 3;
    }

    // Getters and Setters
    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getPhoneNumber() { return phoneNumber; }
    public void setPhoneNumber(String phoneNumber) { this.phoneNumber = phoneNumber; }

    public String getBarangay() { return barangay; }
    public void setBarangay(String barangay) { this.barangay = barangay; }

    public VerificationStatus getVerificationStatus() { return verificationStatus; }
    public void setVerificationStatus(VerificationStatus verificationStatus) { this.verificationStatus = verificationStatus; }

    public String getIdProofPhoto() { return idProofPhoto; }
    public void setIdProofPhoto(String idProofPhoto) { this.idProofPhoto = idProofPhoto; }

    public int getSubmissionCount() { return submissionCount; }
    public void setSubmissionCount(int submissionCount) { this.submissionCount = submissionCount; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}