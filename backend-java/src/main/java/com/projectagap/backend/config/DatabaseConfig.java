package com.projectagap.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Spring Boot Configuration Class
 * Configures CORS permissions for React (http://localhost:3000)
 * and initializes HTTP client beans for external API calls.
 */
@Configuration
public class DatabaseConfig implements WebMvcConfigurer {

    /**
     * Bean definition for HTTP REST API requests to external services (e.g. Supabase, SMS Gateways).
     */
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    /**
     * Cross-Origin Resource Sharing (CORS) Configuration.
     * Allows frontend-js (running on port 3000) to communicate with Java backend endpoints.
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("http://localhost:3000", "http://localhost:3001", "http://localhost", "capacitor://localhost")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }
}