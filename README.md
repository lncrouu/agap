# Project AGAP

**Active Guardianship & Alert Protocol**

AGAP is a mobile-first hazard reporting and emergency response system for Batangas. It helps residents submit hazard reports, locate nearby emergency services, track report status, and provides administrators and responders with tools to verify, dispatch, investigate, and resolve incidents.

## Project Description

Project AGAP is a React, Java Spring Boot, and Supabase application packaged for Android with Capacitor. The frontend provides the citizen, administrator, and responder workflows, while the Java API validates report submissions and routes notification behavior. Supabase provides authentication, database storage, file evidence URLs, and moderation data.

## Problem Being Addressed

Communities need a fast and organized way to report hazards, provide evidence, find emergency hotlines, and follow the status of a report. AGAP reduces fragmented reporting by keeping submission, verification, dispatch, field findings, and resolution in one system.

The app also supports guests who do not need to create an account, while encouraging resident verification for additional submission access and SMS notification eligibility.

## Project Objectives

- Let users submit geolocated hazard reports with descriptions and photo evidence.
- Show submitted and approved hazards on a severity-filtered map.
- Provide a searchable emergency and department hotline directory.
- Let residents track a report using its ticket number.
- Support resident verification, moderation, penalties, bans, and ban appeals.
- Give administrators tools to review reports, dispatch responders, and resolve incidents.
- Give responders tools to acknowledge dispatches, submit field findings, and update resolutions.
- Keep the notification workflow consistent for verified residents and guest devices.

## Target Users

- **Residents and guests:** Submit and track hazard reports, view nearby hazard zones, and access hotlines.
- **CDRRMO administrators:** Review reports and verification requests, moderate users, dispatch response teams, and resolve incidents.
- **Emergency responders:** Accept dispatched reports, update field status, submit findings, and attach resolution evidence.
- **Batangas City residents and visitors:** Use the public emergency information and hazard map features.

## Main Features

- Resident and guest access
- Hazard submission with severity, location, coordinates, description, and photo evidence
- Ticket-number report tracking
- Danger-zone map with severity filters and device location
- Department and emergency hotline directory with device dialing
- Resident verification requests and username management
- Device penalties, bans, and ban appeals
- Administrator report moderation and permanent-delete or restore controls
- Responder dispatch, acknowledgement, field verdict, and resolution workflow
- Supabase-backed profiles and report data
- Java API report submission and notification routing

## Technologies Used

- **Frontend:** React 18, JavaScript, HTML, and CSS
- **Mobile packaging:** Android and Capacitor
- **Backend:** Java 17 and Spring Boot 3
- **Database and authentication:** Supabase Auth and PostgreSQL
- **Build tools:** npm, Maven, Gradle
- **Testing:** Jest/React Testing Library utilities and Spring Boot test support
- **External communication:** REST APIs and optional SMS gateway integration

## Team Members and Roles

| Member | GitHub | Primary contribution area |
|---|---|---|
| Lance Rougil Bulanhagui | [@lncrouu](https://github.com/lncrouu) | Full-stack development and project implementation |
| Ricie Bulanhagui | [@riciebulanhagui](https://github.com/riciebulanhagui) | Frontend, UI, and application development |

Team roles and responsibilities may be expanded and finalized during project presentation.

## OOP Concepts Used

- **Encapsulation:** Java domain classes such as `IncidentReport` and `UserProfile` keep fields private and expose controlled getters and setters.
- **Abstraction:** `SmsGatewayClient` defines the SMS sending contract, while `ReportService` and `SupabaseReportService` separate report behavior and storage implementations.
- **Polymorphism:** Spring injects implementations behind service and client interfaces. Notification behavior can change without changing the notification controller.
- **Composition:** `ReportNotificationService` contains an `SmsGatewayClient`; `ReportSubmissionController` contains a `SupabaseReportService`.
- **Enumerations:** `VerificationStatus` and `NotificationStatus` represent fixed verification and notification states.
- **Separation of concerns:** React screens handle presentation, service modules handle data operations, Spring controllers handle HTTP requests, and model/service classes handle application rules.
- **Information hiding:** Public REST endpoints expose only the required request and response data rather than directly exposing internal database details.

## Instructions for Running the Program

### Prerequisites

- Node.js and npm
- Java 17 or newer
- Maven 3.9 or newer
- Android Studio with an Android SDK
- A Supabase project
- An Android phone or emulator

### 1. Configure Supabase

Run the consolidated SQL file [`supabase/AGAP_queries.sql`](supabase/AGAP_queries.sql) once in the Supabase SQL Editor after the required `profiles` and `reports` tables exist.

### 2. Configure the frontend

Create `frontend-js/.env.local`:

```text
REACT_APP_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
REACT_APP_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
REACT_APP_API_BASE_URL=http://YOUR_COMPUTER_LAN_IP:8080/api
```

Use the computer's LAN IPv4 address rather than `localhost` when testing from a physical phone.

### 3. Run the Java backend

From the repository root:

```powershell
cd backend-java
mvn spring-boot:run
```

The backend uses port `8080` by default.

### 4. Run the React frontend

For browser development:

```powershell
cd frontend-js
npm install
npm start
```

Open `http://localhost:3000`.

### 5. Run on Android

```powershell
cd frontend-js
npm install
npm run android:sync:local
npm run android:open
```

Connect an Android device with USB debugging enabled, select it in Android Studio, and run the app.

For full Android setup details, see [`frontend-js/README.md`](frontend-js/README.md). For user workflows, see [`USER_GUIDE.md`](USER_GUIDE.md).

## Sample Screenshots

Add screenshots of the main screens before final submission:

- Application splash screen
- Citizen dashboard
- Hazard submission form
- Report tracker
- Danger-zone map
- Hotline directory
- Resident profile
- Administrator command portal
- Responder workflow

Suggested location: `docs/screenshots/`

## Known Limitations

- The Android debug configuration is intended for trusted local testing, not public distribution.
- The administrator passcode is demo authentication and is not a secure production authentication system.
- SMS delivery depends on an available SMS gateway implementation and configuration.
- Guest submission and moderation behavior is tied to browser/device profile data.
- The map and emergency-directory features require location permissions for the most accurate results.
- Network or Supabase outages can prevent submissions, profile updates, or status refreshes.
- Uploaded or linked evidence availability depends on Supabase storage configuration and database policies.
- Automated test coverage is limited to selected frontend and backend behavior.

## Future Improvements

- Replace the demo admin passcode with role-based Supabase authentication.
- Configure a verified production SMS provider with delivery tracking.
- Add cloud image uploads and automated image review.
- Add push notifications for report-status changes.
- Improve map clustering and real-time hazard updates.
- Add analytics and reports for CDRRMO operations.
- Add stronger offline support and synchronized cached reports.
- Expand automated tests for all user roles and backend endpoints.
- Add accessibility features and multi-language support.
