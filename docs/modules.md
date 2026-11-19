# Module Map

A file-level guide to where each feature lives, for anyone new to the codebase. See
[`architecture.md`](architecture.md) for how the pieces fit together and
[`ai-integration.md`](ai-integration.md) for the AI gateway contracts.

## Runtime schema ownership

Flyway owns PostgreSQL DDL in `backend/src/main/resources/db/migration/`. Docker starts an empty
database and Hibernate validates, never creates runtime tables. `SchemaMigrationConfiguration`
enforces this boundary; `SchemaMigrationTool` provides an operator-only migration command without
starting business services. `LegacySchemaAdoption` checks schema/uniqueness before explicit V1
adoption. `LegacySchemaAlignment` handles the inspected pre-Flyway local variant transactionally,
without changing business rows; it is not called on application startup. See README for backup,
adoption, drift refusal and immutable-version rules. `database/schema.sql` and dated migrations
are historical references only.

Manual-payment input uses `InvoiceInputMoney` before storage. Approval requires a separate
`receivedDate`; `SessionClock.AUCKLAND` owns the ledger day boundary. Submission/review timestamps
are retained, historical actual receipt dates stay null, and no date is inferred from upload time.

Report draft GET queries remain read-only. At the user's request, shared `useReportReview` restores
the original editor flow: opening automatically prepares current evidence and resumes saved wording,
without a separate Prepare prerequisite or an additional statistics panel. Parent locks plus partial
unique indexes protect open draft identity across tabs. Version checks and frozen exports remain.

`feedback/FeedbackSummaryEmailService` orchestrates legacy reviewed-summary delivery without a
database transaction. `FeedbackEmailDeliveryStore` owns authorization, row locks, revision claims,
payload snapshots and completion in separate committed transactions; it never invokes SMTP.
Repeat/uncertain requests never replay delivery. Generation/review remain in `FeedbackSummaryService`,
transport remains in `ReportEmailGateway`. Architecture tests enforce these dependency/transaction
boundaries; integration tests exercise duplicate, in-flight and historical revision behavior.

`useReportReview` centralizes report/section acceptance so generation, individual saves, save-all and
approve-all clear only successfully saved edits. Failed sections retain unsaved wording. Read-only
reload and explicit preparation share reset behavior but never share evidence-freshness permission.

## Shared console UI ownership

- `features/accomplishment-entry/` owns achievement entry: `useAchievementEntry` handles selection,
  validation and commands; details, recipient and footer components render its typed controller.
  `components/CreateAccomplishmentModal.tsx` is a compatibility re-export, not a second implementation.
- `features/console-shell/` owns pure role-scoped navigation badges and shell classes. Pages import
  its public `index.ts`; no reads or writes are performed by navigation construction.
- `hooks/useDialogFocus.ts` owns initial focus, Escape, Tab wrapping and focus restoration for
  shared dialogs/sheets. `lib/dialogScrollLock.ts` reference-counts the body lock across nested
  overlays. Views must not add independent body-overflow or global-keydown implementations.
- `lib/emailAddress.ts` performs bounded UI screening only; server identity checks remain authoritative.
  `report-review/reportDeliverySelection.ts` owns delivery labels and truthful outcome descriptions,
  not transport or retry policy. See `quality/main-findings.md` for this cleanup's scope and exceptions.

## Attendance metric contract

Attendance rates use `(present + late) / (present + late + absent)` in class lists/details, session
registers, dashboards and reports. `lib/attendanceAnalytics.ts` owns `attendanceRate` and
`recordedAttendanceCount`; no recorded marks yields `null`, not 0%. Expected/unknown marks remain
available for separate recording completeness. Unknown-only sessions/days are not plotted or ranked
as low attendance. Regression coverage: `attendanceRateConsistency.test.cjs`, `attendanceTrendModel.test.cjs`.

- Backend `AttendanceMetricPolicy` owns recorded-mark/rate and past-completed eligibility rules.
  Reports, student history, directory aggregates and `StudentAttendanceBenchmarkService` use this contract;
  the benchmark bulk-loads exact enrolled offerings and returns weighted aggregates only, never peer identities.
- Staff roster responses include `studentLevel`. `attendanceComparisonModel` partitions that historical
  roster by campus or **current profile level**, never by current enrolment. Missing level metadata has
  an explicit Unassigned bucket. Expected, recorded and attended totals must reconcile across partitions;
  session counts overlap across groups and must not be added together. Historical levels are not stored.
- `studentAttendanceEvidence` matches stable student identity on those roster rows for console/profile
  statistics. Session caches discard rows belonging to a different session during navigation.
- `classOverviewModel` calculates full attention totals before limiting previews, and sorts only past
  completed lessons into Recent completed sessions. UI components render these models without recounting.
- Root-regression tests: `AttendanceMetricPolicyTest`, `AttendanceServiceTest`, `StudentDirectoryServiceTest`,
  `attendanceRateConsistency.test.cjs`, `studentProfileModel.test.cjs`, `sessionAttendanceModel.test.cjs`.
- `reportMetrics` and personal report details reuse `studentAttendanceEvidence` and the same past-completed
  clock; a date range extending into the future cannot turn premature Completed flags into evidence.

## Billing arithmetic contract

- `PaymentCollectionPolicy` owns supported collection methods. Statements advertise `paymentMethods`;
  both `PaymentService.checkout` and the Demo adapter enforce the same rule before any ledger/access
  write. Default MANUAL supports bank/cash review only; DEMO requires `payment-demo` and is forbidden
  in `production`/`prod`. `demoMode` is retained as a truthful compatibility label, not a UI capability.
  `ProductionMailPolicy` validates production SMTP configuration without connecting or sending mail.
  Tests: `PaymentCollectionPolicyTest`, `PaymentCheckoutPolicyTest`, `ProductionMailPolicyTest`,
  `ManualPaymentServiceTest` and `paymentCapabilities.test.cjs`.

- `InvoiceStatusPolicy` derives published status from exact balance, net payments and the Auckland
  business date; DRAFT/CANCELLED remain explicit lifecycle states. Readers do not rewrite old invoices.
- `InvoiceStatusQuery` applies the same rules in the database before pagination; `financialStates`
  and `InvoiceSummaryProjection` supply matching counts and per-invoice debt totals. Test policy/query
  parity for every stored label, including stale PAID and stale PARTIALLY_PAID, before changing either rule.
  Administrator list rows and summary share a repeatable-read snapshot and one school date.
- `InvoiceDebtProjection` is the per-invoice debt/overdue boundary shared by account rows, invoice
  summaries and billing operations. `balance` includes all issued debt; `overdueBalance` includes
  only unpaid past-due invoices. The account's highest-priority state never determines its overdue
  amount. A batch uses one Auckland date for state, invoice selection and due-date calculations.
  `summary.issued` sums actual non-draft/non-cancelled net invoice charges, not receipts plus debt;
  surplus payments cannot pay another invoice without an explicit allocation. `collectionRate`
  is server-calculated settled charges / issued charges, rounded half-up to a whole percent.
  `summary.overdueCount` counts invoices, not students; desktop/mobile labels preserve that unit.
  `PaymentMetricContractTest` checks repository, account, operations and HTTP parity with mixed due
  dates, multiple invoices per student, surplus payments, credits, refunds and failed transactions.
  Register rows and payment-issue counts both use `InvoiceStatusPolicy.needsPaymentAction` with the
  derived status; cancelled invoices are not payment issues. A legacy course-only fallback has no
  invoice due dates and leaves `overdueBalance=null`, never substitutes its aggregate balance.
- `BillingOperationsService` owns period validation and the snapshot transaction only.
  `BillingOperationsFinancials` owns cash/debt attribution; `BillingOperationsAlerts` owns follow-up
  queries/rules; pure `BillingCourseProjection` owns class/student deduplication and lesson-use totals.
  Add a follow-up rule to Alerts, not the financial calculator; add a class metric to the projection
  with a focused test. All three run within the same read-only snapshot.
- Frontend `useBillingOperations` owns period inputs, loading/retry and obsolete-response guards;
  `BillingOperationsWorkspace` only renders it. `billingOperationsState.test.cjs` tests these reads;
  `paymentModuleBoundaries.test.cjs` keeps extracted views out of transport/state management and
  recursively checks that payment calculation models do not import React or API clients, including
  re-exports and lazy imports. `InvoiceReviewModal` delegates drafts/cache, edits and explicit commands
  to `useInvoiceReview`; rendering never mutates the draft cache. `invoiceReviewState.test.cjs` covers
  private saves, generation failures, unsaved edits and delivery retry keys without real delivery.
- Invoice delivery separates durable preparation (`PREPARING`) from the no-resend boundary
  (`SENDING`). Only pre-send preparation can expire after ten minutes. `SENT`/`DEMO` replay the
  same key; `SENDING`, `UNKNOWN` and legacy `IN_PROGRESS` never automatically resend under any key.
  `InvoiceDocumentService` owns locked transitions; `InvoiceDeliveryService` orchestrates the
  external send outside the transaction. `invoiceDeliveryOutcome` keeps batch uncertainty distinct
  from success. Recovery of an uncertain outcome requires provider verification, not a timeout.
- New report snapshots and assistant/account projections use this policy. Frozen report exports are
  never refreshed from live records. Ledger writes persist the current derived state under the invoice lock.

- `InvoiceAdjustmentPolicy` validates exact cents before any account mutation. Fee credits cannot
  exceed current debt; refunds and mistaken-payment reversals remain distinct audited operations.
  A refund returns any existing overpayment first and reduces fees only for its remaining portion.
- `studentPaymentModel.statementPaymentEntries` includes posted receipts, refunds and reversals with
  their signed balance effects; failed payments and pending claims are not cash. Desktop/mobile open
  and historical statements expose the same entries. Legacy overpayments are displayed, not auto-refunded.
- Timestamped feedback and payment dates use `sessionTime`'s Auckland calendar; due dates remain date-only.
  Student active-enrolment counts use offering IDs, never the historical course-filter list.

- `BillingOperationsFinancials` separates period cash flow (`PaymentTransaction.occurredAt`, Auckland
  dates, start-inclusive/end-exclusive, capped at snapshot time) from **current** outstanding/overdue
  balances. Invoice creation date is not a receipt or publication date. Drafts are excluded; refunds
  remain signed cash flow, including on cancelled invoices. Lesson-use figures are current, not period activity.
  The operations read uses repeatable-read isolation; old-range frontend responses cannot replace newer scopes.
- `InvoiceCourseAllocation` is read-only attribution, not a ledger mutation. It distributes signed integer
  cents over all charge amounts, with deterministic largest-remainder rounding. Shared discounts are
  proportional. Unlinked/ambiguous amounts remain explicitly unassigned; legacy single-course invoices
  retain their sole course link. Class amounts plus unassigned amounts must equal the financial total.
- `InvoiceInputMoney` rejects non-positive, over-precision and out-of-range invoice amounts before
  validation or persistence. Frontend `payments/money.ts` calculates drafts in integer cents and applies
  the same DECIMAL(12,2) input bounds. Zero net is invalid in both single and batch invoice flows.
  `InvoiceAmountInput` presents these constraints and inline errors consistently in all invoice editors.
- Regression coverage: `InvoiceCourseAllocationTest`, `InvoiceInputMoneyTest`, `PaymentServiceTest`,
  `paymentModels.test.cjs`. Test discounts, penny splits, negative refund periods, old invoices paid now,
  new invoices paid outside the period, future transactions, unlinked fees and zero-net drafts.

## Student signup and self-service profile

- [Phase 4B](phase4b-student-signup.md) adds DOB/contact fields, a per-student guardian relationship,
  separate mailbox/signup permission and independent admin relationship confirmation. Only new
  self-signups requiring guardian confirmation are blocked; legacy, staff-provisioned and no-guardian
  approvals keep their contract. Guardian confirmation never grants any biometric/camera consent.
- `auth/accountlinks/StudentSignupProfiles` owns profile validation, optimistic writes and the approval
  condition; `StudentContactVerification` reuses digest-only account links with student/revision binding.
  The exact public confirm-contact POST preserves CSRF. Guardian inspection exposes only the student's
  display name, purpose and role, never contact data. Student/guardian contact data must not be logged.
- `features/student-signup/` owns the student profile form and Admin guardian review behind `index.ts`.
  The staff `features/student-profile/` stays separate. PendingApproval and StudentProfileSettings only
  connect the feature; ConsentPanel stays intact. Editing contact email does not replace login identity.
- Students can log in with their Student ID or existing email; both aliases share the login rate budget.
  V11 is additive and preserves old account-link purposes and KIOSK roles. UI and real SMTP checks belong
  to the integration owner; unit/H2 tests do not validate actual PostgreSQL upgrades.

## Backend layering

- `auth/` owns durable session entities/repository, cookie policy, Spring Security configuration,
  production-origin validation and the HTTP-to-domain gate adapter. `SessionAuthService` remains the
  existing gate facade; `AuthService` owns account/password verification, not browser storage.
  Login is a write transaction because issuing a durable session writes PostgreSQL. Profile reads
  stay read-only; rejected session revocation uses an independent security transaction.
- `LoginAttemptService` normalizes/hashes the login identity and applies configured limits;
  `auth/LoginAttemptWindow` owns the admission policy, `LoginAttemptStore` owns independent
  PostgreSQL transactions/version-conflict retries, and `LoginAttemptCleanup` removes expired
  windows. The controller reserves before password verification and only acknowledges success.
  Failed requests keep their slot even when the login transaction rolls back. Late success cannot
  clear a newer revision/window; no in-memory fallback, forwarded-IP trust or raw email storage.
- `apiClient` owns same-origin credentials, masked CSRF acquisition and stale-response rejection.
  `useAuth` owns restore/login/logout state and non-secret cross-tab notices; `SessionNotice` only
  renders a failed-sign-out retry. It is excluded from printing. No localStorage credential fallback.
- `auth/accountlinks/` owns activation/recovery, not ordinary session transport:
  `AccountLinkRequests` queues generic requests after a separate rate budget; `AccountLinkTargets`
  resolves current eligibility; `AccountLinkDelivery` commits a no-resend claim; `AccountLinkWorker`
  sends outside the database transaction through the disabled/SMTP gateway. `AccountLinkProofs`
  checks identity/purpose/expiry/password fingerprint and locks consumption in the caller's write
  transaction. `AccountPasswordReset` changes the password and revokes sessions in that same commit.
  Plaintext proof exists only during delivery/in browser memory; the table stores its digest.
  `features/account-access/` owns request, proof routing, reset forms and shared password validation;
  existing `AuthPage` retains registration/face steps. Verification never bypasses face/admin gates.
- New-student registration opens the original account/classes form directly and does not require
  email delivery or an email proof. Face verification, consent and PENDING administrator approval
  remain mandatory. `emailProof` is optional on the student DTO only for this first-time path;
  claiming an existing passwordless student still requires a valid identity-bound proof and cannot
  overwrite an existing account by knowing its number/email. Staff-email collisions are rejected.
  Staff activation retains proof requirements. `AssistedAccountActivation` is the local-only,
  administrator-gated issuer for existing passwordless records; it reuses digest storage and the
  existing binding/expiry/single-use redemption. It cannot reset passwords, approve enrolment or
  choose a role. Production profiles deny issuance. Mail-based password recovery is unavailable
  in the local UI until account mail is configured.
- `WorkflowCapabilities` exposes non-secret configured workflow availability to a shared frontend
  hook. UI affordances fail closed while loading or on error; this is not a substitute for server
  authorization. `InvoicePortalPublicationService` independently coordinates locked authorization,
  reviewed-message persistence and invoice publication in one transaction, without email/PDF or
  email-delivery timestamps. Existing SMTP delivery and its replay guards are unchanged.
- Account-link tests use a test-source-only capturing mail gateway. No local inbox API, console-link
  fallback, automatic email send on startup or public credential response is part of the application.
- Tests: `BrowserSessionHttpTest`, `PostgresSessionRestartTest`, `ProductionBrowserPolicyTest`,
  `SessionAuthServiceTest`, `authSession.test.cjs`, `apiClientSession.test.cjs`. The PostgreSQL harness
  validates fresh/upgraded schemas and real HTTP login/logout across full application reconstructions
  on its own disposable container, never the installed database.

`backend/src/main/java/io/github/huijingmen/softeng789/classroommonitoring/`

| Package | Contains |
| --- | --- |
| `controller/` | REST endpoints, one class per feature area. Thin — delegates to `service/`. |
| `service/` | Business logic, AI gateway interfaces and their demo/HTTP/SMTP implementations, `SessionAuthService` (auth and sessions), `StaffAccessService` (teacher/admin resource boundaries), `TeacherScopeSupport` (shared per-class scoping) and `PageRequestSupport` (bounded list requests). Remote AI and email calls run outside database transactions. |
| `entity/` | JPA entities, one per database table. |
| `repository/` | Spring Data repositories. |
| `dto/` | Request/response records exposed by controllers, including the stable generic `PageResponse` contract. |
| `client/` | HTTP clients calling out to `ai-service/` (e.g. `HttpFaceEnrollmentGateway`). |
| `config/` | Cross-cutting config such as `CorsConfig`. |

New, self-contained business areas may use a vertical package instead of adding more files to every
global layer. Student billing is the first example: `billing/` keeps its domain, DTOs, repositories,
provider boundary, service and controller together while preserving the same controller-service-
repository dependency direction.

## Admin assistant

- `assistant/` is an admin-only read module: controller → orchestration → registered attendance, schedule, payment and student-count tools. `AssistantStudentLookup` resolves names/numbers and requires selection for ambiguity; query filters are parameterized and escaped. `AssistantStudentCountPlan` handles closed current-total phrases without inference; `AssistantStudentCountTool` aggregates unique records with approval/status boundaries, not enrolment totals.
- The AI adapter `/assistant/plan` returns only a validated intent/filter plan, never SQL or factual answers. Spring reads authoritative records in a read-only transaction after inference and rechecks authentication. No billing mutation services are called.
- `features/admin-assistant/` owns the global drawer, memory-only conversation hook, API, typed answer renderer and scoped styles; the shell imports only `index.ts`. Logging out unmounts the conversation. Source buttons open existing lesson/account workflows.
- `useAdminAssistant` owns requests/context/retry; `useAssistantPanel` owns responsive dialog/focus/scroll cleanup. `AssistantPanel` composes turns and answers; `AssistantConversationParts` owns the welcome actions and input composer. Public-entry checks prevent page-level imports of assistant or student-overview internals. Backend query/choice limits are named at their owners; registered tools are tested against injected billing mutation services.
- Student overview: backend `studentoverview/` owns the paginated aggregate and single-student refresh; existing billing services retain account/credit rules. Frontend `studentOverviewState.ts` owns scoped identities and refresh merges; `useStudentOverview` owns cancellation and debounced reads. Old-scope cells are never actionable. `SessionClock` and `lib/sessionTime.ts` own real UTC ↔ Auckland conversion. See `architecture.md` for the explicit legacy-request boundary and reviewed database repair/rollback procedure.
- `StudentOverviewService` loads authorized source records; pure `StudentOverviewProjection` calculates
  full-scope counts, exception filtering and page slices. `StudentOverviewPolicy` owns matching and
  attention rules. New totals belong in the projection, not controllers or browser recounts.
- `assistantSuggestions` defines contextual one-click follow-ups; each carries its answer's student scope and clears irrelevant course filters when changing topic. Student selections survive failed requests/retries. `AssistantPaymentSummary` owns currency-separated bounded totals and flags stored-status/ledger mismatches without updating invoices.
- Completed answers reveal their opening summary inside the conversation container, without scrolling the surrounding page. Mobile prose is 16px; source, retry, pagination and student-choice controls retain 44px touch height.
- Unsupported requests offer global supported queries without carrying a previous student. `AssistantStudentClarification` collects a name/number or explicit matching choice; `studentSearch` resumes the original typed read scope via `AssistantClarificationPlan`, without another model call. Admin authorization, date limits, literal matching and choice validation still apply. Failed resolutions preserve the original scope for retry.
- Dates use Auckland time, ranges are limited to 31 days, and limited results are disclosed. Missing marks are not absences; cancelled/upcoming lessons are separate. Payments are current issued-invoice snapshots; unverified submissions are not receipts. No writes, historical financial totals or course-filtered finance in this version.
- Extend by adding a typed intent, registering an `AssistantTool`, updating the planner schema/prompt and source renderer, and testing authorization, empty/ambiguous/truncated results and read-only behavior. Tests: `AdminAssistantTest`, `AssistantPlanPolicyTest`, `test_admin_assistant.py`, `adminAssistant*.test.cjs`.

## Lesson register

- `LessonCreditPanel` renders the editor; `useLessonCreditPanel` owns source loading, unsaved edits,
  guarded commands, post-save refresh and dialog lifecycle. `lessonCreditPanelModel` owns reusable
  options/labels. Test the hook directly; do not rewrite component source to expose private functions.
- The shared `LessonPanelHeading` keeps student number, course/term, exact lesson time and location visible in the lesson drawer. Student-overview selection matches student + offering + session, marks the source cell/row/column, and uses the same session-time formatter as the drawer; attendance/payment decisions are unchanged.
- Wide registers reserve the drawer width. `useSelectedLessonVisibility` reveals the selected cell between pinned columns and the drawer, adjusts on resize, and restores horizontal position on close. It never scrolls the page or adds a vertical table scroller; narrow layouts retain the persistent lesson heading.
- At the same wide breakpoint, the selected cell sits visually above the dimming layer and retains its actual status colors. It is pointer-inert while the modal is open; narrow layouts never raise a background cell above the full-width drawer.

## Manual payment review

- `ReviewPaymentModal` owns receipt review separately from `ManualPaymentAdminPanel` (queue/bank settings). `manualPaymentReviewModel` owns note validation, explicit currency and Auckland timestamps.
- `useManualPaymentQueue` owns server pagination (10 per page), student filtering, cancellation, retries and recovery when the last page shrinks. `/admin/payments/manual-payments` applies the optional `studentId` filter before paging and orders by submission time + ID. Queue and review use the same Auckland timestamp; queue failures never display an empty-success state. Tests: `manualPaymentQueue.test.cjs`, `ManualPaymentServiceTest`.
- `useManualPaymentReview` owns decision validation, duplicate-submit protection, review errors and callback state; the modal only renders them. Receipt loading stays independent in `usePaymentReceipt`, so preview failures cannot accidentally become approval policy.
- `PaymentReceiptPreview` displays authenticated PDF/image evidence on opening, beside invoice checks on desktop and before them on mobile. `usePaymentReceipt` cancels replaced requests and revokes local blob URLs on close; files are not sent to an external viewer. Preview loading, failure or absence does not block manual approval: administrators must verify actual cash receipt or the institution bank account. Approval records this decision, not file availability. Tests: `paymentReceiptPreview.test.cjs`, `manualPaymentReview.test.cjs`.
- Cash attachments are optional in `PaymentMethodModal` and the multipart API. No attachment is a normal manual-verification state, not a file error. Administrators may approve after checking the institution cash record, including when an optional attachment is unavailable. Submission stays pending; only approval adds a ledger payment and records reviewer/time/note. Bank transfers still require an attachment. Existing databases need `20261024_allow_cash_without_receipt.sql`; no existing payment rows are rewritten.
- Review payloads include invoice number and ledger-derived balance when loaded. Approval rechecks the locked invoice's open state and remaining balance; stale or duplicate reviews cannot add another receipt.
- Rejection requires a nonblank student-visible reason in both browser and service. Approval notes remain optional. Tests: `ManualPaymentServiceTest`, `manualPaymentReview.test.cjs`.

## Student reports

- Backend `reports/`: source evidence, AI adapter, versioned drafts, review, email and frozen publication. Frontend `features/student-reports/` exposes preparation, delivery and published-report views through `index.ts`.
- Student, class and overall inference runs outside database transactions. Before saving generated text, `TeacherScopeSupport.requireCallerForWrite` rechecks ACTIVE status under a shared staff-row lock held through the short write transaction; committed deactivation rejects the result without changing the draft/version. The shared caller resolver also rejects inactive staff for ordinary service authorization. PostgreSQL concurrency coverage lives in `PostgresStaffAuthorizationTest` and the disposable schema harness.
- Queue responsibilities: `useStudentReportWorkspace` loads/filters/pages progress; `useStudentReportEntry` opens/resumes reports and discards late responses; `StudentReportTaskRow` renders identity, photo fallback, status and actions. Preparation checks own `student-report-checks.css`, independent of queue styling.
- Reports → Students is a searchable, course/status-filtered, paginated work queue for exact dates and each student's enrolled offering IDs. `POST /api/student-reports/workspace` is read-only (max 100 scopes per request), authorizes every scope server-side and lists the caller's private drafts separately from published summaries without preparing drafts or invoking AI. An explicitly labelled latest other-scope draft can be resumed when its courses remain within the authorized selection; mobile uses the central report-level navigation.
- Reopening the report editor refreshes evidence for its original saved scope and preserves wording. Changed evidence can invalidate approval for re-review; changing the selected scope still requires applying it. Preparation checks disclose missing attendance marks and teacher feedback and link to student records; missing marks are not absences, no-feedback wording stays factual and ineligible achievements are omitted.
- “Save all drafts” writes only changed summaries sequentially using each returned version and `approve: false`. On partial failure, completed saves remain and unsaved edits stay in the editor; saving does not approve, publish or email a report.
- `runSequential` carries each resolved report version into the next write; approval stops on failure, generation records partial failures, and workspace reads remain batched. Do not parallelize these revision-dependent writes.
- Shared `report-review/reportGeneration` and `ReportGenerationDialog` expose per-section states, elapsed time and saved-response percentages for all report types. All-success 100% closes automatically after 650 ms; failures stay visible and never count as saved progress. Refresh evidence before retrying an unconfirmed response. Generation does not approve or deliver; leaving stops subsequent generation requests.
- Both Students/profile and Reports/student use the same editor. Attendance, payments, absences/make-ups and teacher-feedback synthesis are mandatory; achievements appear only for confirmed, report-included records without pending corrections in the selected courses/dates.
- All narratives are visible/editable by default; source records expand on demand. “Save & approve all” saves current wording with sequential version checks, skips unchanged reviewed sections and stops on failure. Remaining edits stay in the editor. Outdated wording can be regenerated or manually checked/edited and explicitly acknowledged against the new evidence before individual or bulk approval. Saving a draft alone does not clear staleness.
- `StudentReportDocument` renders the same approved wording for preview and PDF. Its frozen source appendix includes only the student's applicable lesson records, up to three dated/attributed feedback excerpts (360 characters each), and eligible confirmed achievements; pending corrections are excluded. Sources can also be inspected before approval. `reportDocumentModel` presents learning headings without rewriting prose. A4 styles isolate the document and add page numbers; disable browser headers/footers.
- `report-print-isolation.css` hides every body sibling of the active report portal, including `#root`, navigation and dialogs. Explicit overall exports take precedence; otherwise personal reports take precedence over legacy overview/class portals. Never target only `.app` when isolating print output.
- `useMediaQuery` freezes responsive component selection during printing and resumes it on the next screen frame, preventing paper width from unmounting an open report.
- `StudentReportSnapshotBuilder` stores profile, scoped courses, attendance counts/weekly trend, confirmed observations, feedback count and `preparedAt` (data-as-of time, not the original draft creation date). `ReportSessionTime` excludes future dates/starts even if prematurely marked completed. Payment facts come from `PaymentReportEvidence`; charts never use AI-derived numbers. Attendance rate is not engagement. Published snapshots stay frozen; legacy reports do not invent missing historical timestamps or facts. No-feedback reports retain a factual empty-state section.
- `StudentReportEvidence` scopes attendance and leave by the linked lesson's selected offering before building facts/snapshots. Legacy lessons without an offering are excluded, never guessed into a class or rewritten; their original records remain intact.
- `POST /api/student-reports/prepare` resumes a draft by student, creator, courses and dates. Section generation/editing and publication require its current `version`; conflicting edits return 409. Refreshing changed evidence preserves wording but invalidates approval. All sections must be approved before delivery; published reports cannot be edited.
- `ReportRecordsDraft` writes attendance and payment narratives from the same saved snapshot as the charts/tables, without model inference. Scheduled lessons are not lessons attended; invoice `PENDING` is not a payment submission. Draft-policy changes mark existing wording outdated on prepare and preserve manual text for regeneration or explicit human re-review. Published snapshots are not rewritten.
- Payment evidence separates period transactions from current balances; unverified payments are not receipts. Mixed-course/unlinked invoices are excluded explicitly. Attendance gaps are not absences, and booked make-ups are not proof of attendance.
- PDF, email and the student portal use the same reviewed narratives. Email POST requires `{version}` matching the preview (use the returned new version after publication). `StudentReportEmailService` commits a durable claim before SMTP; `(report_id, report_version)` is unique. Repeated requests replay the receipt, including after reopening. Timeout/crash outcomes return `UNKNOWN` and must be checked with the recipient/mail administrator; automatic resend is blocked. This is at-most-one attempt per revision, not an exactly-once SMTP guarantee. PDF and portal delivery remain available.
- Student-report schema is included in the Flyway baseline; do not replay historical scripts on installed databases.

## Class reports

- Reports → Classes → open a class → **Review & export report**. Four editable sections: attendance, payments, absences/make-ups and class-wide teacher feedback. Personal achievements are excluded, including when reopening older class reports; original stored history is not rewritten. No individual progress notes are substituted for class feedback.
- `reports/ClassReport*` separates historical attendance, class-attributable payments, evidence, versioned review and persistence. `ReportSectionReview` and frontend `features/report-review/` share approval/staleness rules with student reports; class views stay in `features/class-reports/`.
- Attendance is weighted by recorded student marks and respects enrolment dates. Completed class sessions and expected student marks are separate counts. Unknown marks, future sessions and cancelled sessions do not become absences. Charts/registers use the saved snapshot, never model-generated figures.
- Class reports identify students by name and number with attendance/recording counts. The appendix adds lesson-level missing/absent mark counts and suggested checks, plus up to three class-wide feedback excerpts. No personal progress notes or achievements. Lesson registers show recorded/expected marks.
- `ReportSourceModels`/`ReportSourceEvidence` own bounded source projections; `ReportSnapshotReview` versions rendered facts as well as narrative evidence, excluding preparation timestamps. Changes to individual attendance invalidate class roster approval even when aggregate totals are unchanged. Shared source/roster tables live in `features/report-review/`; wrappers own scope. Missing historical sources are not live-hydrated.
- Payments group issued, class-only invoices by currency. Mixed/unlinked invoices are explicitly excluded; pending submissions are not receipts. Snapshot balances are not period-only transactions or whole student accounts.
- `/api/class-reports`: prepare; versioned section generate/edit; finalize; get; latest 10 finalized reports per class. Export finalizes a frozen version before printing; **Saved reports** reopens it. Teacher class access is enforced. No student access, portal publication or email route.
- Flyway owns class-report schema upgrades. Dedicated class PDF pages isolate navigation/dialogs and label financial/student data **Staff only**.

## Overall reports

- Admin → Reports → Overview. Choose **Internal operations** or **Partners & reviewers**, dates and courses (empty selection = all; max 100). No billing/financial data in this edition; teacher overview remains permission-scoped and unchanged.
- Backend flow: `OverallReportEvidence` authorizes/selects scope; `OverallReportCourseEvidence` loads each course; pure `OverallReportSnapshotBuilder` assembles weighted totals, roster and audience projections; `OverallReportDrafts` creates narratives. Service owns review/frozen persistence. Queries do not belong in snapshot assembly.
- Frontend `features/overall-reports/` separates workspace, document, course table, metrics, actions and pure formatting. Workspace/reference panels never import the print document. Student/Class/Overall share attendance presentation in `report-review/reportAttendance.ts`; it reads stored rates and computes recording completeness, not business eligibility.
- Overall preview/PDF groups identical follow-up guidance while retaining each course/issue count. Print starts the student roster on a new page and keeps table headers with the first row; saved facts and approved wording are not rewritten.
- Workspace layout separates setup, evidence overview, primary draft editor and reference records. Attendance/completeness show raw counts; scope totals are secondary. Review actions and the route-scoped app header stay in normal flow. `OverallReportSnapshotPanel` changes workspace hierarchy only; preview/print layout remains independent.
- `overall-report.css` is the ordered stylesheet entry: workspace/shared tables → screen evidence → preview → document → responsive → print. `overall-report-evidence.css` owns the snapshot strip and grouped follow-up list; responsive overrides stay in `overall-report-responsive.css`. Keep import order because screen and PDF overrides share selectors.
- `useOverallAttendanceShortcut` owns the screen-only disclosure ref, internal-snapshot availability and focus/scroll navigation. `OverallReportSnapshotPanel` only renders the count/action; `OverallReportFollowUp` renders grouped courses and receives navigation callbacks. Neither presentation component fetches evidence or saves report/attendance records. Shared issue identity and pure grouping stay in `overallReportContent.ts`.
- Unique students are deduplicated across courses. Attendance uses recorded marks; recording completeness uses expected marks. Historical enrolments, past completed sessions and confirmed/corrected observations are reused from class evidence. Missing marks are not absences. Optional achievements count only eligible confirmed, report-included records; partner exports contain no individual details.
- Numerical sections use snapshot facts, not AI. Only class-wide teacher feedback uses AI, with audience-specific prompts. All sections are editable and must be approved. Changed source records preserve wording but require re-review.
- `OverallReportContent` builds detailed factual wording and course/week evidence fingerprints. `OverallReportDetails` renders snapshot-only coverage, weekly marks and per-course teacher-note availability; course tables expose attendance denominators and missing/absent counts. AI feedback retains supported course/date scope and separates proposed actions from completed work. No new source data is inferred or added to frozen snapshots.
- Internal Overall includes a deduplicated name/number roster, enrolled courses and raw attendance counts from the same historical scope. `OverallReportRoster` aggregates records without loading personal feedback. Partner reports omit the roster server-side and in rendering. Retired detailed personal appendices are ignored without rewriting stored history.
- `ReportAchievementEligibility` excludes achievements with pending correction requests in student and overall reports. `OverallReportReviewEvidence` invalidates approval when the internal roster or aggregate achievement/observation facts change, not when only preparation time changes. Personal notes are never loaded for Overall evidence or AI.
- `/api/overall-reports` is admin-only: prepare, versioned section generate/edit, finalize, get and latest 10 saved reports. Audience is part of draft identity. Partner payloads omit operational issue lists and credit-decision counts; administrators must check free-text privacy before finalization. This is human review, not guaranteed automatic anonymization.
- Export freezes the exact preview even if printing is cancelled. History reads frozen facts, never live records. No email or student-portal publication. Flyway owns schema creation/upgrades.

Face-enrolment files are written atomically behind a per-student update lock. A storage snapshot
is committed with the database transaction or restored on rollback, so a failed registration
cannot leave orphaned captures or overwrite a previous valid enrolment.

### Report maintenance boundaries

- Pages/components consume student, class and overall report `index.ts` exports. `check-frontend-boundaries.sh` also blocks concrete-feature imports from shared review and print-document dependencies in workspaces. Add new report content through its evidence loader, snapshot contract, renderer and tests; keep prompts in the AI adapter, not React.
- Backend services own authorization, optimistic versions and transactions. Evidence builders own source facts; `ReportSectionReview` owns review policy; `ReportDocumentJson` owns typed snapshot serialization and preserves feature-specific errors. Serialization must not fetch live records or alter frozen reports.
- Modal scroll locking uses a screen-only body attribute. Print portals own visibility and page assignment through scoped selectors, not inline overflow overrides or `!important`.
- Run `./scripts/quality-check.sh` after changing report contracts or shared review logic. It runs backend, frontend and AI tests plus the frontend build.

## Frontend layering

`frontend/src/`

| Directory | Contains |
| --- | --- |
| `pages/` | Top-level views, one per screen (`Dashboard.tsx`, `Students.tsx`, `HealthAlerts.tsx`, `AdminClasses.tsx`, ...). `TeacherApp.tsx` is the shell that lazy-loads the selected teacher/admin workspace; `StudentPortal.tsx` is the separate student-facing shell. |
| `components/` | Shared and feature components. `components/auth/` (login/registration), `components/mobile/` (responsive mobile chrome and flows), `components/student/` (student-portal-only views) are role/context-specific subfolders. |
| `features/` | Cohesive vertical modules for screens whose data orchestration or business-derived view model is too large for a page. `features/payments/` keeps payment contracts, API calls, formatting, hooks and admin/student views together; `features/student-profile/` owns profile records and desktop/mobile models; `features/reports/` and `features/class-reports/` own report loading, models and role-specific views; `features/campuses/` owns campus/room management, derived room usage and dialogs; `features/dashboard-attendance/` separates analytics state, chart models, filters and SVG presentation; `features/session-attendance/` owns attendance transforms and resilient cache loading. Pages remain thin coordinators. |
| `hooks/` | Shared data-fetching and state hooks, one per feature area (`useConsole`, `useAuth`, `useHealthAlerts`, `useAccomplishments`, ...). `useConsole` is a compatibility facade composed from focused hooks such as `useConsoleNavigation` and `useConsoleFilters`; new concerns should be added to focused hooks rather than directly to the facade. Server-paged screens share `usePagedResource` for loading, errors and stale-response protection. |
| `lib/` | API clients (one per feature area, e.g. `studentApi.ts`, `healthAlertApi.ts`, `accomplishmentApi.ts`) plus framework-free utilities (formatting, sorting, chart math). |
| `styles/` | Ordered style layers. `theme.css` contains shared tokens and primitives; desktop feature families live in `directories-analytics.css`, `reporting-monitoring.css`, `registration-settings.css`, `console-workspaces.css` and `accomplishments.css`; `print.css` is print-only; mobile and student styles remain in their named surface files. Payments is split by surface (`payments-student`, `payments-admin-directory`, `payments-invoice-flow`, `payments-mobile`, `payments-requests`, `payments-manual`, `payments-admin-workspaces`, `payments-overview`) rather than returning to one monolithic stylesheet. Preserve the import order in `main.tsx` when adding a layer. |

## AI service layering

`ai-service/app/`

| Directory | Contains |
| --- | --- |
| `api/` | FastAPI route handlers. Thin — mirrors the backend controller convention. |
| `models/` | Pydantic request/response models. |
| `services/` | Stable provider protocols and application-owned prompt construction. Computer-vision services remain explicit mocks. |
| `providers/` | OpenAI-compatible adapters. `openai_client.py` owns transport; `openai_runtime.py` owns Ollama, LM Studio and vLLM options shared by report and payment-message providers. |
| `config/` | Validated environment configuration for the selected private inference runtime. |

## Feature areas: backend and frontend files

| Feature area | Backend | Frontend |
| --- | --- | --- |
| Auth & sessions | `AuthController`, `AuthService`, `SessionAuthService`, `LoginAttemptService` | `AuthPage.tsx`, `useAuth.ts`, `authApi.ts` |
| Student & enrollment | `StudentController`, `AdminStudentController` (approve/reject/withdraw), `StaffStudentController` (staff-created registration), `StudentService`, `StudentDirectoryService` (scoped roster filters, attendance projection and paging), `StaffStudentRegistrationService`; entities `Student`, `CourseEnrollment` | `Students.tsx`, `StudentProfile.tsx`, `AddStudentModal.tsx`, `useStudentsData.ts`, `useStudentDirectoryPage.ts`, `studentApi.ts` |
| Face enrollment | `FaceRegistrationVerifier` (registration gate), `FaceEnrollmentGateway` (provider port), `FaceEnrollmentService` (persistence orchestration), `FaceEnrollmentStorageService` (files), `HttpFaceEnrollmentGateway` (HTTP adapter), entity `FaceEnrollment` | `FaceEnrollmentFlow.tsx`, `CameraCapturePanel.tsx`, `useCameraCapture.ts`, `faceEnrollment.ts` |
| Campuses, rooms & classes (Admin) | `CampusController`, `RoomController`, `ClassController` (read), `AdminClassController` (manage), `CampusService`, `RoomService`, `AdminClassService`; entities `Campus`, `Room`, `CourseOffering`, `CourseOfferingTeachers` | `AdminCampuses.tsx`, `features/campuses/`, `AdminClasses.tsx`, `ClassDetail.tsx`, `campusApi.ts`, `roomApi.ts`, `classAdminApi.ts` |
| Attendance & sessions | `AttendanceController`, `ClassroomSessionController`, `AttendanceService`, `ClassroomSessionService`, `ClassroomSchedulePlanner`, `ClassroomSessionSpecifications`; `ClassroomSessionService` owns persistence and lifecycle transitions while `ClassroomSchedulePlanner` owns request resolution, availability and conflict rules; entities `ClassroomSession`, `AttendanceRecord`; bounded batch reads avoid one HTTP request per historical session | `Attendance.tsx`, `SessionDetail.tsx`, `useSessionAttendance.ts`, `useSessionDirectoryPage.ts`, `features/session-attendance/`, `classroomApi.ts`, `attendanceAnalytics.ts`. `features/class-schedule/scheduleModel.ts` is the framework-free source for recurrence, generated sessions and availability groups; `ClassScheduleBuilder` renders and submits that model rather than duplicating scheduling rules in JSX. |
| Entrance attendance kiosk ([guide](phase4a-entrance-kiosk.md)) | `kiosk/` package. `KioskController` (staff launch/list/end and kiosk device routes) and `KioskReviewController` (admin review). `KioskSessionService` owns launch, scope, lifetime and credential revocation; `KioskCaptureService` reserves attempts and calls the recognizer without holding locks; `KioskDecisionService` owns confirm/cancel and the `KIOSK` attendance write; `KioskPayloads` encrypts candidates and captures and creates evidence and review items; `KioskReviewService` serves the admin queue; `KioskRetention` purges expired attempts, evidence and kiosks every 10 minutes. Face readiness comes from `VisionService` (`faceReadyStudentIds`, `kioskProfileMatches`) and session scope from `TeacherScopeSupport.sessionAccessPredicate`. Tables from V9/V10. | `features/entrance-kiosk/`: `KioskLaunchPage.tsx` (staff), `KioskDeviceScreen.tsx` and `useKioskDevice.ts` (device), framework-free `kioskFlowModel.ts`, `launchModel.ts` and `presenceGate.ts`, `kioskCapture.ts` (one JPEG per scan). `features/kiosk-review/` owns the admin queue and its open-count badge. |
| AI behaviour events | `BehaviourEventIngestController` (authenticated machine boundary), `BehaviourEventController`, `BehaviourEventService`, `BehaviourEventSpecifications`, `AiServiceAuthenticator`, `AiObservationContextResolver`, `EventTypeMapper`; entity `BehaviourEvent` | `Events.tsx`, `EventCard.tsx`, `useEventReview.ts`, `useBehaviourEventPage.ts`, `behaviourEventApi.ts` |
| Health Alerts & Incident Reports | `HealthEventIngestController` (authenticated machine boundary), `HealthAlertController`, `HealthIncidentReportController`, `HealthAlertService`, `HealthIncidentReportService`, `AiServiceAuthenticator`, `AiObservationContextResolver`, `TeacherScopeSupport`; entities `HealthAlert`, `HealthIncidentReport` | `HealthAlerts.tsx`, `AdminHealthAlerts.tsx`, `useHealthAlerts.ts`, `useHealthIncidentReports.ts`, `healthAlertApi.ts`, `healthIncidentApi.ts` |
| Progress reports & class feedback | `ProgressReportController`, `ClassFeedbackController`, `ProgressReportService`, `ProgressReportStorageService`, `ClassFeedbackService`; entities `ProgressReport`, `ClassFeedback` | `ClassReportsTab.tsx`, `CreateFeedbackModal.tsx`, `progressReportApi.ts`, `classFeedbackApi.ts` |
| AI feedback summaries | Legacy overview uses `FeedbackSummaryService`; student/class reports use `reports/` for versioned sections and snapshots. FastAPI separates protocol, prompts and provider. | `features/reports/`, `features/student-reports/`, `features/class-reports/` share `features/report-review/` approval/editing; `StudentReportsView.tsx` shows published personal reports. |
| Student accomplishments | `AccomplishmentController`, `StudentAccomplishmentController`, `AccomplishmentService`, `AccomplishmentFeedbackService`; entities `Accomplishment`, `AccomplishmentFeedback` | `Achievements.tsx`, `StudentAccomplishmentsView.tsx`, `useAccomplishments.ts`, `accomplishmentApi.ts` |
| Student payments | `billing/` vertical module. Controllers separate student statements, admin invoices, manual-payment review, reconciliation and package operations. `PaymentService` delegates draft construction to `InvoiceDraftFactory` and admin reads to `AdminPaymentQueryService`; account, ledger, entitlement, lesson-credit, make-up and delivery rules stay in focused services. | `features/payments/` owns contracts, API adapters, models, hooks and views behind `index.ts`. `classBillingPlanModel.ts` owns plan validation; payment CSS is split by surface. |
| Student schedule | `StudentScheduleController` exposes a self-only read endpoint; `StudentScheduleService` joins active enrolments, published sessions, the student's attendance and lesson-credit coverage into one purpose-built response without exposing teacher session APIs | `StudentScheduleView.tsx` owns the responsive timetable presentation; `studentPortalApi.ts` owns its contract, `useStudentPortalData.ts` loads it independently with partial-failure handling, and `student-schedule.css` is the isolated responsive style layer |
| Student and parent requests | `support/` owns request submission, review state and requester details. `StudentSupportRequestService` controls the request lifecycle; `LeaveRequestApprovalService` is the transactional coordinator that delegates attendance facts to `AttendanceService` and prepaid-lesson decisions to `LessonCreditManagementService`, so support, attendance and billing rules remain separate | `ContactSchoolModal.tsx` submits and tracks requests; `features/student-requests/` owns the admin queue and makes the attendance and prepaid-lesson outcome explicit before approval; `studentSupportApi.ts` owns the shared contract |
| Admin: staff & registrations | `AdminController` (staff accounts), `AdminStudentController` (registration approvals) | `AdminStaff.tsx`, `AdminRegistrations.tsx`, `adminApi.ts` |
