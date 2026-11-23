# AGENTS.md

Shared instructions for AI coding agents in this repository. Codex reads this file directly and
Claude Code imports it from `CLAUDE.md`, so both agents follow the same rules. Change rules here,
not in agent-specific files.

## Project

AI Enhanced Classroom Monitoring System (SOFTENG 789 team project).

| Path | What it is |
| --- | --- |
| `frontend/` | React 18 + TypeScript + Vite portals for students, teachers and admins |
| `backend/` | Java 21 Spring Boot education server; owns PostgreSQL |
| `ai-service/` | Python 3.12 FastAPI adapter: CPU photo attendance, face enrollment, legacy contract mocks |
| `backend/src/main/resources/db/migration/` | Flyway migrations (`V<n>__name.sql`), the only source of schema changes |
| `database/` | `schema.sql` is historical reference only; `migrations/` holds compatibility entries that wrap Flyway DDL |
| `docs/` | Architecture, module map and per-phase guides |
| `scripts/` | Quality gate, security check and schema tests |

Start with `docs/architecture.md` and `docs/modules.md`. Phase guides are named
`docs/phase<id>-<topic>.md` with a Korean twin `docs/phase<id>-<topic>.ko.md`.

## Language

- Reply to the user in the language they write in.
- App UI text, code, identifiers and commit messages stay in English.
- New phase guides come as an English `.md` and Korean `.ko.md` pair. Handoff notes may be Korean only.

## Domain invariants

Taken from the linked docs (read 2026-11-04); "code:" marks a spot-check in source. If code and
docs disagree, say which one you followed and tell the user.

- AI results never confirm attendance on their own; a scoped teacher confirms every write.
  [phase1](docs/phase1-photo-attendance.md), [phase2a](docs/phase2a-student-checkin.md),
  [phase2d](docs/phase2d-mobile-photo-attendance.md)
- No face, an excluded face or a missing mark is not an absence.
  [phase2c](docs/phase2c-attendance-review.md), [phase2d](docs/phase2d-mobile-photo-attendance.md),
  [phase3a](docs/phase3a-webcam-events.md)
- Role gates (`requireTeacher` and others) and per-class scope (`TeacherScopeSupport`) are separate
  checks; a teacher role alone does not grant access to a class or its students.
  [architecture](docs/architecture.md); code: `service/TeacherScopeSupport.java`
- Biometric consent, local-analysis consent, observation sharing and live-video sharing are separate;
  one never implies another. [phase2a](docs/phase2a-student-checkin.md),
  [phase3a](docs/phase3a-webcam-events.md), [phase3b](docs/phase3b-webcam-sharing.md),
  [phase3c](docs/phase3c-live-video.md)
- Webcam observations are not evidence of attendance, attention, sleep or fatigue.
  [phase3b](docs/phase3b-webcam-sharing.md), [phase3c](docs/phase3c-live-video.md),
  [phase3d](docs/phase3d-local-eye-head.md)
- A student's payment submission is not a receipt; only admin approval after checking the actual cash
  or bank record adds a payment. [production-readiness](docs/production-readiness.md),
  [modules](docs/modules.md); code: `ManualPaymentSubmission` starts as `PENDING`
- Published report snapshots stay frozen, and an email delivery with an `UNKNOWN` outcome is never
  resent automatically. [modules](docs/modules.md); code: `StudentReportEmailService`

## Never do

- Read, print or copy secrets or personal data: `.env`, `.env.*` (except `.env.example`), anything
  under `data/local-dev/`, `*.local.*` files, and face images, templates or captures under `data/`.
- Log face templates, embeddings or raw images, even at debug level.
- Run `data/local-dev/setup.py` or the full `database/schema.sql` against a local database, or delete
  `data/local-dev/postgres-data`.
- Edit an existing Flyway `V<n>__*.sql` file.
- Push to `upstream`, merge into `main`, force-push or rewrite shared history. The user opens
  upstream pull requests and merges them.
- Edit files in another agent's worktree or commit to another agent's branch.
- Commit `AGENTS.md` or `CLAUDE.md` to a working branch. They live only on the fork branch
  `DoJun/agent-config`, which has no shared history with the project and never goes to `upstream`.

## Database changes

- Add a new Flyway file with the next free version in `backend/src/main/resources/db/migration/`.
  The latest at the time of writing is `V8__webcam_pause_and_optional_review.sql`.
- Only one agent adds migrations at a time. The task brief names the version you may use; if it
  names none, ask before adding a migration.
- Compatibility entries in `database/migrations/` must not contain `CREATE TABLE`; they include the
  canonical Flyway DDL. `scripts/tests/test_phase2_migration_sources.py` checks this.

## Code conventions

- Consume frontend features through their public `index` file. `scripts/check-frontend-boundaries.sh`
  enforces this.
- Commit messages use a `feat:`, `fix:`, `refactor:`, `docs:` or `test:` prefix, one change per commit.

## Testing

Run checks from the source of the worktree you are verifying, in Git Bash.

### This Windows machine

| Area | Command |
| --- | --- |
| Frontend tests | `cd frontend && npm test` |
| Frontend typecheck and build | `cd frontend && npm run build` |
| AI service tests | `cd ai-service && .venv/Scripts/python -m unittest discover -s tests -p "test_*.py"` |
| Script tests | `ai-service/.venv/Scripts/python -m unittest discover -s scripts/tests -p "test_*.py"` |
| Backend tests | `cd backend && mvn -q test` |

- `python` and `python3` in Git Bash are Windows Store aliases here, not a working interpreter. Use the
  `ai-service/.venv` interpreter (Python 3.12).
- `mvn` is not on the Git Bash `PATH`. Maven 3.9.5 exists under `~/.m2/wrapper/dists/` and a JDK 21
  under `data/tooling/jdk21`; this setup is not verified. If backend tests cannot start, report them
  as not run.
- In `scripts/tests/test_session_time_migration.py`, the symlink and `os.O_DIRECTORY` cases fail on
  Windows. That explains only those cases; treat any other failure as real.
- A worktree without `ai-service/.venv` may borrow the main checkout's interpreter
  (`D:/UOA2/2026/Softeng789-ai-classroom-monitoring/ai-service/.venv/Scripts/python`) only if its
  `ai-service/requirements*.lock` files match the main checkout's. Never install or upgrade packages
  in a borrowed environment.

### Ubuntu CI only

- `./scripts/quality-check.sh` calls `python3` and expects `ai-service/.venv/bin/python`.
- `sh scripts/check-security.sh` needs network access and Maven.
- `python3 scripts/test-postgres-schema.py` needs Docker, which is not installed here.

Report every check as passed, failed or not run with a reason. A check that did not run is not a pass.

## Local app and UI checks

The local stack runs only from the main checkout `D:\UOA2\2026\Softeng789-ai-classroom-monitoring`,
because its ignored `data/local-dev/` folder holds the database and settings. Other worktrees do not
have it. See `docs/local-run-windows.ko.md`.

- Start: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\data\local-dev\start.ps1`
- Stop: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\data\local-dev\stop.ps1`
- Ports: frontend 5173, backend 8080, AI service 8000, PostgreSQL 55440. Only one stack runs at a time.
- Do not open `data/local-dev/settings.json` or `LOGIN.local.txt`. Ask the user to sign in.

Before a UI check:

1. Record the folder the stack runs from, its branch and commit (`git rev-parse --short HEAD`), and
   which uncommitted changes the check includes.
2. A worktree change is checked only after the integration owner brings it into the main checkout
   without discarding the work already there. Backend and AI service changes need a restart.
3. A check on a stack that does not contain the change is not a check of that change.
4. Agree restarts and integration with any agent working at the same time, through the user.
5. If no suitable stack is available, hand off with "UI check: not run" and the reason.

## Multi-agent workflow

The user runs two coding agents in parallel. Both can design, implement, test and review. The table
gives default focus only; the user's assignment for a task overrides it.

| Agent | Folder and branches | Default focus |
| --- | --- | --- |
| Claude Code (Opus 5.5, xhigh effort) | Main checkout for integration and UI checks; own worktree under `D:\UOA2\2026\` for implementation; `DoJun/*` | Design and task briefs, frontend implementation with its tests, integration and UI checks, review of Codex's work, security review of face and auth changes |
| Codex (GPT-6 Astra, high effort) | Own worktree under `C:\Users\ASUS\.codex\worktrees\`, `codex/*` | Backend, Flyway migration and script implementation with their tests, review of Claude's work, pull request review fixes, CI fixes |

Each task names an implementer, a reviewer and an integration owner. Assign them by current context,
task scope and what the other agent is doing. The reviewer is never the author.

Split by area (from 2026-11-23): a task that spans both areas is split between the two agents.

- The brief fixes the API contract first: endpoints, request and response fields, and error codes.
- Codex then builds the backend side and Claude builds the frontend side, at the same time, on
  separate branches.
- Changing the contract mid-task needs agreement through the user.
- Each agent reviews the other's part, and Claude integrates both branches in the main checkout.
- A task that stays in one area goes to that area's owner.
- Claude never implements in the main checkout, because the local stack runs there.

1. One agent, one branch, one folder. Other worktrees cannot see uncommitted files; commit to hand off.
   Worktrees do not contain `AGENTS.md` or `CLAUDE.md`. Read them from the main checkout, or copy them
   in untracked with `git restore --source=DoJun/agent-config -- AGENTS.md CLAUDE.md`.
2. The brief's change scope is what you may edit. Reading related files is always allowed, and the
   brief lists related tests and docs you may also update.
3. Coordinate before changing a do-not-touch file, a file another agent owns, or an API or database
   contract. Keep working on the independent parts meanwhile.
4. Do not repeat an approach without new evidence. Analyse the failure and try a different approach.
5. Hand off with what you need and what you tried when a user decision, permissions, an external
   dependency or another agent's work blocks you.
6. Commit at each working checkpoint, so that an agent stopped by a usage limit leaves no uncommitted
   work behind.
7. While developing, run only the tests related to your change. Run the full suites once, before the
   handoff. Write long test output to a file and read only the summary and the failures.

These shared files have one owner per task: Flyway migrations, `scripts/test-frontend-models.sh`,
`frontend/package-lock.json` and `ai-service/requirements*.lock`. In a split task the backend
implementer owns the migrations and the frontend implementer owns the two frontend files, unless the
brief says otherwise.

### Task brief

Written by the user or an agent before work starts. Omit lines that do not apply.

```text
Task: <one sentence>
Roles: implement <agent, or backend Codex + frontend Claude> / review <agent per part> / integrate <agent>
Branch: <branch per implementer>, base commit <sha>
API contract: <endpoints, fields and error codes both sides build against | none>
Change scope: <paths>
Related tests and docs: <paths that may also change>
Do not touch: <paths>
Migration version: <V9 | none>
Done when: <tests that must pass, behaviour to see>
Runtime check: <UI or API check needed | none>
Read first: <docs or commits>
```

### Handoff

In the pull request description or final commit message. Analysis and review tasks without a commit
hand off in the final reply. Omit lines that do not apply.

```text
Summary: <what changed or was found>
Result: <commit sha | uncommitted: paths>
Checks run: <command: result>
Not run: <check: reason>
UI check: <folder, URL, commit, extra uncommitted changes | not run: reason>
Open issues: <remaining problems and decisions needed>
```
