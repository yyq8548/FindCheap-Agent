# ADR 0001: PostgreSQL access uses parameterized `pg`

- Status: Accepted
- Date: 2026-08-13

## Decision

The Commerce Foundation accesses PostgreSQL 17 through the `pg` driver with explicit parameterized SQL and a small transaction wrapper. Migrations and repository integration tests run against the PostgreSQL service supplied by Docker Compose locally and GitHub Actions in CI.

## Context

The implementation plan proposed Drizzle ORM and Testcontainers. The implemented foundation is intentionally smaller: its repository surface is narrow, the SQL includes PostgreSQL-specific JSONB, advisory-lock, and conditional-upsert behavior, and CI already owns the database lifecycle. Adding Drizzle or Testcontainers now would duplicate working infrastructure without improving the approved contracts.

## Consequences

- SQL, conflict predicates, migrations, and row mapping remain explicit and reviewable.
- Every dynamic value must remain a bound parameter; identifiers are limited to internal fixed allowlists.
- Repository and migration behavior requires real PostgreSQL integration coverage.
- Schema changes are maintained as ordered, checksummed SQL migrations.
- There is no ORM-generated schema or Testcontainers-managed lifecycle; Docker Compose and CI service configuration must stay aligned with PostgreSQL 17.
