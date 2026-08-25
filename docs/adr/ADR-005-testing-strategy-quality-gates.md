# ADR-005: Testing Strategy and Quality Gates

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform is designed as a long-term business system where reliability is a critical requirement.

As the platform grows, changes must not introduce regressions into existing business workflows.

The system requires a predictable quality process covering:

- code correctness;
- production builds;
- user workflows;
- data integrity;
- critical business operations.

---

# Decision

Madina Platform uses a layered testing strategy with mandatory quality gates.

The validation process includes:

1. TypeScript validation;
2. Production build verification;
3. End-to-end workflow testing;
4. Persistence failure testing.

---

# Quality Gates

## Gate 1: Type Safety

All application code must pass TypeScript checks.

Purpose:

- detect invalid contracts;
- prevent runtime errors;
- maintain reliable interfaces between modules.

Command:

```text
tsc -b
```

---

## Gate 2: Production Build

Every significant change must pass production build.

Command:

```text
pnpm build
```

Successful build confirms:

- applications compile;
- packages are compatible;
- production assets can be generated.

---

## Gate 3: End-to-End Testing

Critical user workflows are verified using Playwright.

Current test coverage includes:

```text
CRM application loading

Client creation

Product creation

Stock movement creation

Completed sale workflow

Completed purchase workflow

Task lifecycle

Modal accessibility behavior
```

---

## Gate 4: Persistence Reliability Testing

Business operations must not complete when data persistence fails.

Protected scenarios:

```text
Client creation

Task operations

Sale completion

Purchase completion
```

The system must:

1. detect persistence failure;
2. prevent incorrect state changes;
3. notify the user;
4. keep business data consistent.

---

# Testing Architecture

Current testing layers:

```text
Application

     |
     v

Playwright E2E Tests

     |
     v

Business Workflows

     |
     v

Domain Logic
```

Future expansion:

```text
Unit Tests

Integration Tests

API Tests

Security Tests

Performance Tests
```

---

# Development Workflow Rules

Before accepting changes:

1. Review current implementation.
2. Make small controlled changes.
3. Run validation checks.
4. Fix errors before continuing.
5. Commit only verified changes.

---

# Continuous Quality Principle

A feature is considered complete only when:

- implementation works;
- build succeeds;
- tests pass;
- data integrity is preserved.

---

# Consequences

## Positive

Benefits:

- fewer regressions;
- safer development;
- predictable releases;
- higher confidence in business operations.

---

## Negative

Costs:

- additional development time;
- maintenance of test scenarios;
- requirement to keep tests updated.

These costs are accepted because Madina Platform targets reliable business usage.

---

# Future Evolution

Testing strategy will expand with platform growth:

- automated CI pipelines;
- pull request checks;
- code coverage tracking;
- security scanning;
- performance monitoring.

---

# Decision Summary

Madina Platform follows a quality-gated development process where builds, tests and data reliability checks are required before changes are considered complete.