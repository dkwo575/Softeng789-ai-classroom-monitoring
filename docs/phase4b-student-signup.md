# Phase 4B: guardian verification and student profile

[한국어](phase4b-student-signup.ko.md)

## Scope and ownership

Implement: Codex. Review and integration: Claude. Base: `81abf3e`.
Branch: `codex/student-signup-guardian-profile`. The runtime/UI check belongs to
Claude after integration into the main checkout. This worktree never starts or migrates the local stack.

This phase extends self-registration, account links, and the student-facing Profile.
It preserves the existing administrator approval and adult-volunteer face registration policies.
Guardian permission is only permission for signup. It never grants biometric consent, local camera
analysis, observation sharing, or live-video sharing.

## Signup policy

- The new form collects DOB, school name, address, student phone, optional contact email,
  and an optional guardian's name, relationship, email and phone.
- A DOB under 18 on the Pacific/Auckland calendar requires a guardian. The exact 18th birthday
  is adult; February 29 anniversaries use Java LocalDate.plusYears semantics.
  This is the project's workflow threshold, not a claim about universal legal consent age.
- The server rejects guardian email matching the student's login or supplied contact email,
  ignoring case and surrounding whitespace. Different email addresses do not prove guardianship.
- New self-signups with a guardian need guardian email confirmation, explicit signup permission,
  and an independent administrator relationship check before approval. The blocking response is
  HTTP 400 with a specific reason.
- Existing students, staff-provisioned records being claimed, and self-signups without a guardian
  retain their approval contract. Legacy clients may omit the new profile object; DOB is required
  by the new UI but is not retroactively required by the old API.
- A supplied DOB under 18 cannot enter the existing adult face pilot. The vision package and
  PR #36 capture-guide files are unchanged. Facial enrollment remains its separate existing flow.
- Login email remains required by the existing student account contract. Optional student
  contact email is editable but is not a login identity and is not used for report delivery.
  Email-less accounts and guardian-mediated password recovery are future work.
- Login accepts the existing Student ID or account email, using the same password/account.
  Both aliases share the login attempt budget. No guardian mailbox is a student login alias.

The guardian feature commit retains the required caller-supplied Student ID. Automatic Student ID
issuance is a separate reviewable change; existing IDs must not be renumbered.

## Registration and verification

1. A student submits the details and existing attendance choice. The account and requested classes
   remain PENDING.
2. The pending screen shows the saved profile and separate verification statuses. After saving
   changes, the student explicitly requests a login-email or guardian-email link.
3. The existing account-link queue uses the configured mail gateway. Disabled mail is a visible
   failure; no debug links or fake verification are created. An uncertain send is not automatically replayed.
4. The guardian opens the fragment link, which the existing App removes from the address bar.
   Inspection is a read; confirmation requires an explicit CSRF-protected POST and signup checkbox.
5. The administrator opens **Registrations → Guardian details**, checks previously verified
   enrolment records or performs an in-person relationship check, and explicitly confirms the relationship.
6. Existing registration review then approves the account/classes. Guardian confirmation alone
   does not approve either.

Mail links are digest-only, single-use and expire after 30 minutes. Guardian proofs are bound to the
student UUID and guardian revision, not merely the shared mailbox. Siblings can use the same guardian
email without confirming each other's relationship. Changing pending guardian details rotates the
revision and clears old confirmations; already-dispatched links then fail. Password changes and
current account eligibility also invalidate proofs. Unknown, expired, used and absent contact tokens
return the same invalid-link error. Viewing a link never changes consent.

Guardian inspection returns the student display name, link purpose and role; it omits email,
Student ID, classes, phone, address and student UUID. Student contact data is never logged.

## Profile editing and access

The existing student Profile destination mounts `SelfProfileEditor`; `ConsentPanel` is retained.
The pending screen uses the same editor. New logic and public exports are in
`frontend/src/features/student-signup/`; the staff `student-profile/` feature is unchanged.

Students may edit school, address, phone and contact email. DOB can be filled if missing; correcting
an established DOB/name, changing login email, or changing an approved guardian requires the school.
No new administrator identity-correction UI is introduced in this phase. Pending guardians can be
corrected and reverified; a required guardian cannot be removed through self-service.

Writes contain only allowlisted profile fields and the last-read student version. A stale write
returns 409, preserves the draft, and offers explicit discard/reload. Student ID, login identity,
approval, class scope, status and consent fields cannot be set through this endpoint.
Pending sessions still cannot read ordinary portal APIs. Teachers cannot use student self-profile
or admin-only guardian APIs; TeacherScopeSupport and existing staff routes are unchanged.

## API

| Endpoint | Access / behavior |
| --- | --- |
| GET /api/auth/signup/profile | Student self, including PENDING |
| PUT /api/auth/signup/profile | Student self; version + profile, allowlisted fields |
| POST /api/auth/signup/verification | Student self; STUDENT_EMAIL or GUARDIAN_VERIFICATION |
| POST /api/auth/account-links/inspect | Existing public CSRF-protected proof inspection |
| POST /api/auth/account-links/confirm-contact | Exact public POST; token, signupPermission, noticeVersion |
| GET /api/students/{id}/signup-profile | Admin only, no-store |
| POST /api/students/{id}/guardian-confirmation | Admin only; current guardian revision, verification method, true confirmation |

No new wildcard public route, GET mutation, bearer credential, token persistence in browser storage,
or query-string token was introduced.

## Database and rollout

All schema changes belong to `V11__student_signup_guardian_profile.sql`.
The additive student columns preserve existing identities and history. Existing records default
to no new signup checks. `student_guardians` stores one current guardian relationship per student,
allowing the same mailbox on multiple students. Its revision and confirmation metadata are separate
from all biometric tables. `account_links` adds subject binding and preserves STUDENT_REGISTRATION,
STAFF_ACTIVATION and PASSWORD_RESET when extending its purpose constraint.
The login-session role constraint is untouched, including KIOSK.

Only migrate after review/integration with the normal project migration procedure.
V1–V10, historical schema, dependency lock files and local data are unchanged.
H2 behavior tests do not validate the PostgreSQL migration; run the existing disposable PostgreSQL
schema harness in Ubuntu CI (Docker is unavailable on this Windows machine).

## Validation and runtime handoff

Automated coverage includes no-guardian/legacy/staff approval compatibility, minor checks,
separate guardian permission, equal-email refusal, stale profile versions, sibling proof isolation,
changed guardian proof invalidation, HTTP authorization and CSRF, and uniform invalid-link responses.
Frontend tests cover form transitions, adult face gates, date boundaries and profile payloads.

After integration, Claude checks desktop and 390px: registration with/without a guardian,
mail delivery and guardian link, independent admin relationship confirmation, pending restrictions,
profile save/conflict, and unchanged ConsentPanel. Real mail delivery and UI are not claimed by unit tests.

## Known limit: duplicate accounts for one person

This phase does not fully prevent one person from holding more than one student account.
The server only refuses a Student ID or login email that is already registered (case-insensitive).

- The Student ID is typed by the student and is not checked against any school record.
  Entering an unused ID with a different email creates a new pending account.
- A staff-created record is claimed only when the student enters its exact Student ID and proves
  the mailbox. A different ID and email create a second account.
- Matching names, dates of birth or guardian details do not block a signup, and face similarity is
  not used to reject one.

Until reconciliation exists, administrators should compare each pending signup with existing
students (name, date of birth, guardian details) before approving it, and reject duplicates.
Automatic Student ID issuance is deferred for the same reason. The proposal is kept as commit
`a6f7f45`. It will return in its own later migration after existing-record linkage, duplicate
handling and the ID format are decided.

## Remaining product work

A verified mailbox is not verified guardianship. Admins must use independent evidence; a call only
to the newly supplied number is insufficient. Duplicate names are allowed, and face matching is not
used to reject registrations. One-person/one-account reconciliation beyond existing ID/email uniqueness,
a parent portal, student name/DOB correction workflow, login-email replacement, profile avatar upload,
email-less accounts, and minor face-enrollment policy are not implemented in this phase.

## Post-integration review corrections

V11 has already been applied by the integration owner. It is frozen; these corrections add no
migration and do not change the schema or the pending-list API contract. The automatic-ID proposal
is preserved on `codex/student-auto-id-proposal` and is not part of this branch.

The admin queue now loads guardian readiness through the existing admin-only signup-profile API
with at most four concurrent requests. Loading or failed status reads are excluded from the ready
count. Rows and the Review dialog show the pending email, signup-permission or relationship step
before an approval attempt; the dialog disables approval while a required check is incomplete.
Closing Guardian details refreshes the queue's checks. Refresh queue retries failures. Existing and
staff-created registrations retain their guardian approval exemptions. Guardianship and biometric
consent remain independent.

For a pending registration, saving an under-18 DOB is rejected with HTTP 400 while FACE registration
metadata or legacy face consent remains. Approval repeats the check under the existing student row
lock, even when every guardian check is complete. The student can use the existing manual-attendance
switch before saving the DOB. This uses the existing RegistrationFaceService metadata methods;
no vision files, captures, templates or migration files are changed. An adult DOB remains accepted.

The form opens guardian fields immediately when an editable DOB becomes under 18, preserves entered
guardian details, and hides the verified-guardian change notice when no guardian exists. Signup Address
uses the same dark input palette; workspace profile fields retain their current theme. The login
placeholder now accepts the Student ID or email wording.

Claude should recheck desktop and 390px after integration: loading/error/confirmed guardian queue
states and counts, the Review dialog, Address focus/hover, minor DOB input, guardian-free approved
profiles, and DOB rejection followed by manual-attendance recovery. UI checks for this correction
were not run in the isolated worktree; the main local stack does not yet contain it.
