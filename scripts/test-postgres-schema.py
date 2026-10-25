#!/usr/bin/env python3
"""Disposable PostgreSQL: fresh schema and a real pre-billing schema upgraded through the migrations.

Owns a new container with a random ID and loopback-only random port. Never targets the project's DB.
"""
from pathlib import Path
import os
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "a97150b"


def run(*args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-8000:] or result.stdout[-8000:])
    return result.stdout.strip()


def main():
    baseline = run("git", "-C", str(ROOT), "show", BASELINE + ":database/schema.sql")
    name = "classlens-schema-check-" + uuid.uuid4().hex[:12]
    container = run("docker", "run", "--detach", "--rm", "--name", name,
        "-e", "POSTGRES_PASSWORD=schema-test-only", "-p", "127.0.0.1::5432", "postgres:16")
    if not container or any(char not in "0123456789abcdef" for char in container):
        raise RuntimeError("Unexpected disposable container ID.")
    try:
        for _ in range(60):
            # The image's temporary initialization server accepts Unix sockets only.
            # Wait for the final TCP server so readiness cannot race that restart.
            check = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], capture_output=True)
            if check.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready.")
        port = run("docker", "port", container, "5432/tcp").rsplit(":", 1)[1]

        def sql(database, contents):
            return run("docker", "exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                "-h", "127.0.0.1", "-U", "postgres", "-d", database, data=contents)

        for database in ("classlens_schema_fresh", "classlens_schema_upgrade", "classlens_schema_webcam_v6"):
            sql("postgres", "CREATE DATABASE " + database)
        # Fresh database is deliberately empty: Flyway, not Docker init or Hibernate, owns DDL.
        sql("classlens_schema_upgrade", baseline)
        migrations = sorted((ROOT / "database/migrations").glob("*.sql"))
        for migration in migrations:
            if migration.name >= "20260926":
                sql("classlens_schema_upgrade", migration.read_text())
        databases = ["classlens_schema_fresh", "classlens_schema_upgrade", "classlens_schema_webcam_v6"]
        fixture = os.environ.get("CLASSLENS_SCHEMA_FIXTURE_BACKUP")
        if fixture:
            backup = Path(fixture).resolve(strict=True)
            if not backup.is_file() or backup.stat().st_size == 0:
                raise RuntimeError("Expected a non-empty backup fixture.")
            sql("postgres", "CREATE DATABASE classlens_schema_localcopy")
            with backup.open("rb") as source:
                subprocess.run(["docker", "exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
                    "-U", "postgres", "-d", "classlens_schema_localcopy"], stdin=source, check=True, capture_output=True)
            databases.append("classlens_schema_localcopy")
        for database in databases:
            print("Validating versioned migrations:", database, flush=True)
            run("mvn", "-q", "-f", str(ROOT / "backend/pom.xml"), "-Dtest=PostgresMigrationTest",
                "-DschemaCheck.url=jdbc:postgresql://127.0.0.1:" + port + "/" + database, "test")
            print("Validating PostgreSQL ORM contract:", database, flush=True)
            run("mvn", "-q", "-f", str(ROOT / "backend/pom.xml"), "-Dtest=PostgresSchemaContractTest,PostgresSessionRestartTest,PostgresStaffAuthorizationTest",
                "-DschemaCheck.url=jdbc:postgresql://127.0.0.1:" + port + "/" + database, "test")
        print("PASS: fresh/historical schema, HTTP sessions, shared login budgets, staff authorization locks and concurrent single-use account links across restarts validated on disposable PostgreSQL.")
    finally:
        # --rm deletes only this newly-created test container and its anonymous data, never named project volumes.
        subprocess.run(["docker", "stop", "--time", "1", container], check=False, capture_output=True)


if __name__ == "__main__":
    main()
