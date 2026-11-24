package com.projectagap.backend.exception;

public class ReportValidationException extends IllegalArgumentException {

    public ReportValidationException(String message) {
        super(message);
    }
}
