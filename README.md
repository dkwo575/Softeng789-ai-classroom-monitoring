# AI Enhanced Classroom Monitoring System

SOFTENG 789 research project: **AI enhanced student management and classroom monitoring system
for offline classrooms**.

## Current Stage

The application covers teacher, administrator and student workflows: enrolment, classes, attendance,
reviewed AI events, reports, accomplishments, support requests and billing. See
[`docs/modules.md`](docs/modules.md) for the code map.

An optional Phase 1 photo-attendance pilot now uses CPU YuNet/SFace inference, supervised face
enrollment and teacher-confirmed attendance. It is disabled by default; apply the development
migration before starting the updated backend. See [`docs/phase1-photo-attendance.md`](docs/phase1-photo-attendance.md)
for setup, the architecture diagram, API contracts and validation limits. Legacy CV routes remain
contract mocks. Private Qwen provides
reviewable report summaries and invoice-message drafts through provider-neutral gateways. See
[`docs/ai-integration.md`](docs/ai-integration.md).

한국어 설명은 [1차 구현 가이드](docs/phase1-photo-attendance.ko.md)를 참고하세요.
Production hardening is in progress; a passing development build is not deployment approval.
See [`docs/production-readiness.md`](docs/production-readiness.md) for the release blockers and acceptance gates.

Phase 2A adds student webcam check-in requests with **teacher approval**, reusing the same optional
vision service. Apply `database/migrations/20261025_add_student_checkins.sql` after the phase-1 migration
before starting this backend version. See the [2A implementation guide](docs/phase2a-student-checkin.md)
and [한국어 실행·테스트 가이드](docs/phase2a-student-checkin.ko.md). Face matches do not automatically record attendance.

The 2A registration extension adds optional seven-photo webcam enrollment or photo-free manual
attendance, both awaiting administrator approval. Apply `database/migrations/20261026_add_registration_faces.sql`
after the check-in migration. Registration photos expire after seven days and are erased after a decision;
only approved encrypted templates become available for photo attendance. See the registration section in the 2A guides.

Phase 3A adds an opt-in **local webcam movement test** to the student overview on desktop and mobile.
It uses MediaPipe Face Landmarker in a browser worker for face visibility and reference-relative head
geometry. It does not send video/events to teachers, identify students or change attendance.
Run `npm --prefix frontend run setup:webcam` after installing frontend dependencies to prepare the
same-origin model/WASM assets. See the [English guide](docs/phase3a-webcam-events.md) and
[한국어 실행·테스트 가이드](docs/phase3a-webcam-events.ko.md). Teacher live monitoring remains a separate simulation.

## System Architecture

A responsive React web app talks only to the Spring Boot Education Server, which owns PostgreSQL and
reaches AI capability through gateway interfaces. FastAPI hosts the optional CPU photo-attendance
service and legacy contract mocks; CARES integration remains separate. See
[`docs/architecture.md`](docs/architecture.md) for the broader architecture, the
roles/access-control model, and the module breakdown.

## Folder Structure

```text
.
├── frontend/
│   └── React + TypeScript + Vite responsive web portals
├── backend/
│   └── Java Spring Boot education server
├── ai-service/
│   └── Python FastAPI development adapter for laboratory AI integration
├── database/
│   └── schema.sql
├── data/
│   └── local face enrollment images, ignored by Git
├── docs/
│   ├── architecture.md
│   ├── ai-integration.md
│   └── modules.md
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Development Environment

Required, with the versions CI builds against ([`.github/workflows/quality.yml`](.github/workflows/quality.yml)):

- **Java 21** — [Temurin](https://adoptium.net/) or any JDK 21 distribution
- **Maven** — not bundled in this repo (no `mvnw` wrapper yet); install via `brew install maven`
  (macOS) or from [maven.apache.org](https://maven.apache.org/install.html)
- **Node.js 22** and npm — Vite 6 requires Node 18/20/22+; older versions will fail to start
- **Python 3.12** (local development and CI use the same version)
- **Docker Desktop** — for PostgreSQL

Any editor works; VS Code is what this project has been developed in.

## Ports

| Service | URL |
| --- | --- |
| React frontend | http://localhost:5173 |
| Spring Boot backend | http://localhost:8080 |
| FastAPI AI service | http://localhost:8000 |
| Qwen vLLM inference | http://localhost:8001 |
| PostgreSQL | localhost:5432 |

## Environment Variables

Copy the example file before running local services:

```bash
cp .env.example .env
```

Docker Compose reads this root-level `.env` automatically for the values in `docker-compose.yml`
(`POSTGRES_DB`, `POSTGRES_USER`, etc.). Vite is also configured (`envDir` in `frontend/vite.config.ts`)
to read it, so `VITE_`-prefixed variables reach the frontend without a separate `frontend/.env` file.
Browser API requests now always use same-origin `/api`; Vite proxies them to `127.0.0.1:8080` locally.
Legacy `VITE_API_BASE_URL` values are ignored. Production must route `/api` to the private backend
behind the same HTTPS origin as the frontend, and set `PUBLIC_APP_ORIGIN` to that origin without a
trailing slash. The production profile rejects wildcard/additional browser origins.

The Spring Boot backend does **not** read `.env` automatically. Docker Compose requires
`POSTGRES_PASSWORD` in the root `.env` file, and the backend requires the same value in its process
environment. Export it before running Maven (for example,
`export POSTGRES_PASSWORD=... && mvn spring-boot:run ...`) or pass it as a system property.

Optional authentication settings are documented in `.env.example`. By default, five failed login
attempts for the same normalized email within 15 minutes temporarily block further attempts for 15
minutes. Override `AUTH_LOGIN_MAX_FAILURES`, `AUTH_LOGIN_FAILURE_WINDOW` and
`AUTH_LOGIN_BLOCK_DURATION` when a deployment needs different limits. PostgreSQL owns this budget:
restarts and multiple application instances share it. Each in-flight attempt reserves a slot before
password verification. Success clears only an unchanged window, so a late response cannot erase
newer attempts; rejected retries do not extend the block. Expired pseudonymous windows are cleaned
every ten minutes. This account guard is not a substitute for ingress-wide request limits.

Activation uses a 30-minute, single-use proof. Staff must already be provisioned by an
administrator; a link never grants a caller-selected role. New students register
directly without an email-link step and still require face verification and administrator approval.
Claiming an existing passwordless student record retains identity-bound proof protection; knowing its
student number/email cannot grant access to its private records. Resetting a password revokes every
existing session and does not sign the user in automatically.

`ACCOUNT_EMAIL_PROVIDER=disabled` is the safe local default. The UI checks `/api/auth/capabilities`
before offering email actions; password recovery is labelled unavailable rather than offering a
send form that cannot work. Direct email requests still fail explicitly without queuing a send.
For local testing, an active administrator can use **Help activate account** on an awaiting staff
row or a passwordless student's profile, confirm the person's identity, and privately share a
single-use activation link. This does not change an existing password, approve a student, change
roles or send mail. Only its digest is stored. Manual issuance is denied in `production`/`prod`.
Local automated tests use an in-process test inbox, never a real SMTP server.
After a provider/sender/test recipient are authorized, configure `ACCOUNT_EMAIL_PROVIDER=smtp`,
`ACCOUNT_EMAIL_FROM`, `PUBLIC_APP_ORIGIN` and the existing SMTP settings. Production requires SMTP
for account mail as well as report/invoice mail. Links use the configured origin, never request Host.
Requests are queued with a generic response; three requests per email per hour share one budget,
independent of sign-in limits. A delivery claim is committed before sending; uncertain sends are
not automatically retried. Request a new link if needed. Expired requests/proofs are cleaned every
ten minutes. Public request responses and logs never expose a proof; the local administrator-only
issuance response is the explicit exception and uses `Cache-Control: no-store`. Browsers clear the
link from the fragment and keep it only in memory. Refreshing requires reopening the received link.

Invoice publication is independent of SMTP: **Approve & publish to portal** records the reviewed
message and publishes the private invoice in one transaction without generating a PDF, sending
email, or recording an email timestamp. Invoice email actions appear only for configured SMTP.
Reports retain their original PDF/portal/Demo-email options. The original report editor flow is
restored: opening refreshes current evidence and resumes saved wording without an extra Prepare
step. Changed source records can require re-review; finalized exports remain frozen.

Do not commit real secrets. `.env` is ignored by Git.

## Run PostgreSQL

Docker Desktop is required.

```bash
docker compose up -d
```

Check PostgreSQL status:

```bash
docker compose ps
docker compose exec -T postgres pg_isready -U classroom_user -d classroom_monitoring
```

PostgreSQL starts empty. **Flyway is the only runtime schema owner**: the backend applies
`backend/src/main/resources/db/migration/V*.sql` before Hibernate validates its mappings.
Do not run `database/schema.sql` or replay `database/migrations/` on an installed database;
those files are historical references, not the current upgrade procedure.

For a fresh database, start the backend normally, or run the migration-only command below
with `DATABASE_URL` (JDBC), `POSTGRES_USER` and `POSTGRES_PASSWORD` already exported.
The migration tool does not start bootstrap accounts, jobs or email senders.

```bash
sh scripts/migrate-database.sh migrate
```

An existing pre-Flyway database is deliberately refused at startup. Stop application writers,
make and verify a backup, then explicitly adopt V1 **once**:

```bash
export SCHEMA_BACKUP_PATH=/absolute/path/to/verified/database.dump
sh scripts/migrate-database.sh adopt-v1
sh scripts/migrate-database.sh migrate
```

Adoption checks baseline columns/types/nullability, primary/foreign/check/unique constraints,
indexes and duplicate open-report scopes before recording V1. It does not execute the old
schema script, infer receipt dates, delete duplicate drafts or assert that historical data
repairs have happened. Resolve any refused mismatch through a reviewed migration, not by
turning on automatic baselining. Keep the backup and preflight evidence. A non-empty file
check is not a restore drill.

The inspected local pre-Flyway variant lacks three classroom foreign keys, a room-code index
and two supported make-up event values. If adoption reports exactly this known variant, the
backed-up operator may first run `sh scripts/migrate-database.sh align-local-v1`, then adopt/migrate.
Alignment validates constraints and the full baseline before committing; orphan references or
unrecognized schema drift roll it back. It never repairs or deletes business rows automatically.

Applied migration checksums are validated on every startup; edit mistakes fail closed.
Never modify an applied `V*.sql`, run `repair` to hide drift, or enable `baseline-on-migrate`
or `clean`. Add the next version instead. New environments receive structure only, not
demo students/classes. First production-owner provisioning is a separate operator acceptance step,
not a reason to run the old seed script. Existing local administrator records are preserved.
Historical bank/cash receipts retain their original ledger dates;
new approvals require an explicit actual Auckland receipt date. Submission and approval
timestamps remain separate.

New valid cookie sessions survive normal restarts until their 12-hour absolute expiry;
sign-out and account revocation are durable in PostgreSQL.

Stop PostgreSQL:

```bash
docker compose down
```

## Run Spring Boot Backend

If `mvn` is not found in a new terminal, refresh the shell configuration first:

```bash
source ~/.zshrc
```

Run with the PostgreSQL profile:

```bash
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=postgres
```

Health check:

```bash
curl http://localhost:8080/api/health
```

```json
{
  "status": "ok",
  "service": "backend"
}
```

The backend reaches AI functionality through small gateway interfaces, configured via the
`AI_SERVICE_URL` environment variable (default `http://127.0.0.1:8000`, matching the FastAPI service
below) — no controller or service code changes needed to point it elsewhere. See
[`docs/ai-integration.md`](docs/ai-integration.md) before connecting a laboratory model.

## Run FastAPI AI Service

```bash
cd ai-service
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
python -m pip install --only-binary=:all: --require-hashes --no-deps -r requirements-cv.lock
# Set the same long random AI_ADAPTER_KEY in the ignored root .env for Spring and FastAPI.
uvicorn app.main:app --reload --env-file ../.env --host 127.0.0.1
```

Health check:

```bash
curl http://localhost:8000/health
```

Person detection placeholder:

```bash
curl -X POST http://localhost:8000/detect/person -H "X-AI-Adapter-Key: $AI_ADAPTER_KEY"
```

Seven-capture face contract (the development mock does not claim real AI verification):

```bash
curl -X POST http://localhost:8000/face/enroll/captures \
  -H "X-AI-Adapter-Key: $AI_ADAPTER_KEY" \
  -F subject_id=TEST-0001 \
  -F 'poses=["front","slight_left","left","slight_right","right","chin_up","chin_down"]' \
  -F images=@/path/to/front.jpg \
  -F images=@/path/to/slight-left.jpg \
  -F images=@/path/to/left.jpg \
  -F images=@/path/to/slight-right.jpg \
  -F images=@/path/to/right.jpg \
  -F images=@/path/to/chin-up.jpg \
  -F images=@/path/to/chin-down.jpg
```

## Run Private Qwen Text Drafts

The FastAPI adapter uses one OpenAI-compatible boundary, so Spring and React do not depend on a model
runtime. Use a smaller Qwen model in Ollama or LM Studio for local development and
[`Qwen/Qwen3-30B-A3B`](https://huggingface.co/Qwen/Qwen3-30B-A3B) behind vLLM in production.

### Local macOS development with Ollama

Install Ollama, pull a Qwen model sized for the development machine, and configure the root `.env`.
The example below matches the lightweight model used by the local end-to-end check:

```bash
ollama pull qwen3.5:4b
```

```dotenv
LLM_RUNTIME=ollama
LLM_BASE_URL=http://127.0.0.1:11434
LLM_API_KEY=ollama
LLM_MODEL=qwen3.5:4b
FEEDBACK_SUMMARY_PROVIDER=http
PAYMENT_MESSAGE_PROVIDER=http
```

Ollama exposes the OpenAI-compatible endpoint used by the existing provider; no Ollama SDK is added
to application code. This small model validates the workflow locally, but it is not the production
quality target.

### Alternative local development with LM Studio

Load a Qwen3 8B quantized model, start LM Studio's local server, and copy the exact model id returned
by `GET http://127.0.0.1:1234/v1/models`. Configure the root `.env`:

```dotenv
LLM_RUNTIME=lmstudio
LLM_BASE_URL=http://127.0.0.1:1234
LLM_API_KEY=lm-studio
LLM_MODEL=<model-id-returned-by-lm-studio>
FEEDBACK_SUMMARY_PROVIDER=http
PAYMENT_MESSAGE_PROVIDER=http
```

### Production with vLLM

The Compose overlay requires a Linux host with an NVIDIA GPU and NVIDIA Container Toolkit. Set
`QWEN_TENSOR_PARALLEL_SIZE` when distributing the model across GPUs. Set `LLM_RUNTIME=vllm` and a
private `LLM_API_KEY` in the root `.env`, then start the model server:

```bash
docker compose -f docker-compose.qwen.yml up -d
```

Wait for the first model download and startup, then verify the OpenAI-compatible endpoint:

```bash
curl http://localhost:8001/v1/models \
  -H "Authorization: Bearer $LLM_API_KEY"
```

Start the FastAPI adapter with the root environment file so the neutral `LLM_*` settings reach the
process:

```bash
cd ai-service
source .venv/bin/activate
uvicorn app.main:app --reload --env-file ../.env
```

Then start Spring with:

```bash
export FEEDBACK_SUMMARY_PROVIDER=http
export PAYMENT_MESSAGE_PROVIDER=http
```

The request path is:

```text
Spring FeedbackSummaryGateway
        -> FastAPI /summaries/feedback
        -> private OpenAI-compatible /v1/chat/completions
        -> Qwen structured draft
        -> teacher review before publish/export
```

Invoice messages use the parallel path `PaymentMessageGateway -> /summaries/payment-message -> private
runtime -> administrator review`. React never calls the model. Failed or malformed responses do not
create drafts; `PAYMENT_MESSAGE_PROVIDER=demo` selects the explicit local fallback.

Invoice email defaults to safe demo mode. For real delivery, set `INVOICE_EMAIL_PROVIDER=smtp`,
`INVOICE_EMAIL_FROM`, and the standard Spring Mail variables (`SPRING_MAIL_HOST`,
`SPRING_MAIL_PORT`, `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD`). Preparation failures can retry;
after SMTP starts, uncertain outcomes return `UNKNOWN` and block automatic resend, even with a new
request key. Check with the mail administrator before any manual recovery. A confirmed `SENT` or
explicit `DEMO` result publishes to the portal; uncertain delivery never claims success.

### Production capability checks

Payments default to bank transfer and cash (`PAYMENT_CHECKOUT_MODE=MANUAL`). Student submissions do
not settle an invoice until administrator approval. The statement's `paymentMethods` is authoritative;
disabled checkout also returns 403 if called directly. Local demonstration checkout requires both
the `payment-demo` Spring profile and `PAYMENT_CHECKOUT_MODE=DEMO`; it never collects real money.

The `production` profile (alias `prod`) includes `postgres` and rejects Demo checkout. It requires
both email providers to be `smtp`, valid non-`.local` sender addresses, SMTP host/port/credentials,
authentication, verified TLS and bounded timeouts. Required STARTTLS is configured by default;
implicit TLS can use `spring.mail.ssl.enabled=true`. Startup validation does not send mail or prove
deliverability. Set `REPORT_EMAIL_FROM`, `INVOICE_EMAIL_FROM` and the Spring Mail variables above;
do not put credentials in Git. Identity/session, migration, delivery recovery and operational gates
in the readiness plan still need completion before deployment.

## Run React Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## First Login

A fresh database has no usable accounts — only a passwordless Admin placeholder from
`database/schema.sql`. Activate it once by setting a private bootstrap password before the first
backend startup:

1. **Activate the Admin account.** Use an 8–72 character password that is not committed to Git:

   ```bash
   export BOOTSTRAP_ADMIN_PASSWORD='choose-a-private-password'
   cd backend
   mvn spring-boot:run -Dspring-boot.run.profiles=postgres
   ```

   Sign in as `admin@auckland.ac.nz`, then remove `BOOTSTRAP_ADMIN_PASSWORD` from your shell or
   deployment configuration. Later startups never overwrite an existing password.

2. **Set up the school from the Admin console.** Signed in as Admin, use Campuses, Rooms, Classes and
   Staff to create real campuses/rooms, classes (course offerings), and any teacher or admin accounts
   your team needs directly — no separate registration required for staff you create this way.

3. **Invite staff or let students register.** An Admin first creates teacher accounts; invited
   staff activate through a single-use link sent to the recorded email, confirming their staff
   number and retaining their assigned role. Students choose manual attendance without photos or
   optional webcam enrollment and submit a `PENDING` registration. Admin reviews identity, classes
   and any seven face captures before approval. Claiming an existing student account still requires
   email proof. Supervised enrollment after approval remains available; see the Phase 1 and 2A guides.

## Demo Accounts

To skip setup entirely and explore a populated instance, load the presentation dataset once the
backend is up:

```bash
docker compose exec -T postgres psql -U classroom_user -d classroom_monitoring < database/demo_data.sql
```

This creates three ready-to-use logins (or leaves them untouched if they already exist on your
database) with sample classes, attendance, health records, feedback, accomplishments and student
payment statements already attached:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@auckland.ac.nz` | `Demo1234` |
| Teacher | `111@qq.com` | `12345678` |
| Student | `test.student@aucklanduni.ac.nz` | `TestPass123!` |

`demo_data.sql` is safe to run more than once — it never overwrites a password that's already set,
including on these three accounts.

## Stop Services

React, Spring Boot, and FastAPI can be stopped with `Ctrl+C` in their terminal windows.

PostgreSQL can be stopped with:

```bash
docker compose down
```

## Quality Check

Run the same local checks before committing or opening a pull request:

```bash
./scripts/quality-check.sh
sh scripts/check-security.sh
python3 scripts/test-postgres-schema.py
```

The script checks patch whitespace and frontend module boundaries, then runs backend, frontend and AI
tests plus the frontend production build. It uses `ai-service/.venv` when available and does not modify
development data. The security check needs network access. The PostgreSQL check requires Docker
and uses a new disposable container, validating both fresh and upgraded schemas without touching
your project database. CI runs all three; the dependency gate fails on every advisory without exemptions.

These local checks do not run SonarQube Cloud. Before merging, also check the latest commit's
Sonar quality gate and its Reliability issues; GitHub annotations may show only part of the report.
Review SQL findings against PostgreSQL semantics before changing migration constraints or seed guards.
Do not treat a passing test suite as a passing Sonar gate.

## Feature Status

Implemented (see [`docs/modules.md`](docs/modules.md) for the file-level map):

- Student and Teacher/Admin authentication (registration, login, durable HttpOnly-cookie sessions, per-class RBAC
  scoping via `TeacherScopeSupport`)
- Student self-registration with an Admin approval queue
- Optional supervised YuNet/SFace enrollment and teacher-reviewed photo attendance, with encrypted
  templates and no raw-image storage in the new feature; legacy mock enrollment routes remain
- Classroom sessions and attendance records (manual and AI-sourced), including bounded batch loading
  for session histories
- AI-candidate behaviour-event review (teacher confirm/reject/correct)
- Health Alerts (AI candidates) and Health Incident Reports (formal record) two-entity model
- Progress reports and whole-class feedback
- Qwen3 feedback summaries with schema validation and a teacher draft/review/publish lifecycle
- Student accomplishments with student acknowledgement/correction-request workflow
- Student bank-transfer/cash submissions with administrator review; explicit local-only Demo checkout
- Admin console: campuses, rooms, classes (course offerings with multi-teacher support), staff accounts,
  registration approvals
- Responsive teacher, admin and student portals sharing one React codebase
- PostgreSQL schema and Docker Compose setup
- Architecture, AI-integration and module-map documentation

Not implemented — the computer-vision / language-model layer stays behind the gateway boundary
(`docs/ai-integration.md`) until a real provider is connected:

- YOLO person detection
- Object tracking
- Pose estimation
- Head-down detection
- Leave-seat detection
- Face recognition, face detection, face embeddings
- VLM integration
- Production infrastructure deployment and operational monitoring
