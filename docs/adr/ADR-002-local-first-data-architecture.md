# ADR-002: Local-First Data Architecture

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform CRM is designed as a business management system that must remain reliable even when external infrastructure is unavailable.

At the current development stage the application uses a local-first approach:

- business data is stored locally;
- application workflows can operate without a backend server;
- critical operations validate data persistence before completing;
- the architecture allows future migration to server-based infrastructure.

The decision was made to prioritize reliability, development speed and data integrity during the foundation phase.

---

# Decision

Madina Platform CRM uses a local-first data architecture as the initial persistence strategy.

The system follows these principles:

## 1. Local Data Ownership

The application maintains its own local data state.

Current storage responsibilities include:

- clients;
- products;
- warehouse data;
- purchases;
- sales;
- transactions;
- tasks.

---

## 2. Transactional Persistence Protection

Business operations must not be considered completed if persistence fails.

Protected operations:

- client creation;
- task changes;
- sale completion;
- purchase completion.

The application must:

1. prepare the next state;
2. attempt persistence;
3. confirm successful storage;
4. complete the business operation.

If persistence fails:

- the operation is rejected;
- the user receives an error;
- business state remains unchanged.

---

## 3. Domain Logic Separation

Business rules are separated from UI components.

Responsibilities:

```text
apps/crm

Responsible for:
- user interface
- workflows
- application interaction


packages/core

Responsible for:
- domain rules
- calculations
- business entities


packages/shared

Responsible for:
- common utilities
- shared contracts
```

---

## 4. Migration Readiness

The local-first architecture must not prevent future enterprise expansion.

Future migration targets:

- backend API;
- database server;
- authentication service;
- multi-user environment;
- cloud synchronization.

The current domain model should remain reusable during migration.

---

# Consequences

## Positive

Advantages:

- fast development cycle;
- simple deployment;
- reliable offline-friendly behavior;
- easier testing;
- clear separation of business logic.

---

## Negative

Current limitations:

- no multi-user synchronization;
- no centralized database;
- limited access control;
- local storage constraints.

These limitations are accepted for the current CRM v1 phase.

---

# Future Direction

The next architecture evolution phases:

## Phase 1

Security foundation:

- authentication;
- authorization;
- user roles.

## Phase 2

Backend foundation:

- API layer;
- database;
- migrations.

## Phase 3

Enterprise capabilities:

- multi-company mode;
- audit logs;
- integrations;
- advanced reporting.

---

# Decision Summary

Madina Platform adopts a local-first architecture for CRM v1.

This approach provides a stable foundation while preserving the ability to evolve into a full enterprise ERP platform.