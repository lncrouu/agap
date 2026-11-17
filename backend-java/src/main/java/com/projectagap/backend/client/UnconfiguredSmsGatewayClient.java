package com.projectagap.backend.client;

import org.springframework.stereotype.Component;

import java.util.logging.Logger;

@Component
public class UnconfiguredSmsGatewayClient implements SmsGatewayClient {

    private static final Logger LOGGER = Logger.getLogger(UnconfiguredSmsGatewayClient.class.getName());

    @Override
    public boolean sendSms(String phoneNumber, String messageText) {
        LOGGER.warning("SMS was not sent because no SMS gateway implementation is configured.");
        return false;
    }
}
