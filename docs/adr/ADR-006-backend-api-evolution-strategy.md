# ADR-006: Backend API Evolution Strategy

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform CRM v1 currently operates as a local-first application.

The current architecture provides:

- React application layer;
- shared UI components;
- domain modules;
- local persistence;
- business workflow protection.

This approach allows fast development and reliable operation during the foundation phase.

However, future ERP requirements will require additional capabilities:

- multiple users;
- centralized data;
- remote access;
- mobile applications;
- integrations;
- enterprise security.

The architecture must define a clear migration path without rewriting existing business logic.

---

# Decision

Madina Platform will evolve from a local-first application into an API-driven enterprise platform.

The transition will happen incrementally.

The current domain architecture remains the foundation for future backend development.

---

# Evolution Strategy

## Phase 1: CRM v1 Local-First

Current state:

```text
React CRM

    |
    v

Application Workflows

    |
    v

Domain Modules

    |
    v

Local Persistence
```

Characteristics:

- fast development;
- simple deployment;
- reliable local workflows;
- no backend dependency.

---

## Phase 2: Backend Introduction

Future architecture:

```text
Frontend Applications

        |
        v

API Layer

        |
        v

Application Services

        |
        v

Domain Modules

        |
        v

Database
```

The backend will become responsible for:

- authentication;
- authorization;
- data synchronization;
- centralized storage;
- integrations.

---

# Domain Preservation Principle

Business logic must remain independent from transport and storage technologies.

Current:

```text
packages/core
```

will continue to contain:

- business rules;
- calculations;
- domain entities;
- validation logic.

The backend should consume domain capabilities instead of replacing them.

---

# API Responsibilities

The future API layer will handle:

## Authentication

- user login;
- sessions;
- identity management.

## Authorization

- permissions;
- roles;
- access control.

## Data Operations

- create;
- read;
- update;
- delete.

## Integrations

- external services;
- notifications;
- payment systems;
- third-party platforms.

---

# Migration Principles

## Principle 1: No Big Rewrite

Migration must happen incrementally.

Existing CRM workflows should continue working during transition.

---

## Principle 2: Domain First

New backend services should be built around existing domain boundaries:

```text
clients

inventory

purchases

sales

transactions

reporting
```

---

## Principle 3: Backward Compatibility

Existing data models should evolve carefully.

Changes must consider:

- existing users;
- existing records;
- future migrations.

---

# Consequences

## Positive

Benefits:

- scalable architecture;
- easier SaaS development;
- support for multiple clients;
- better security;
- enterprise readiness.

---

## Negative

Costs:

- additional infrastructure;
- more complex deployment;
- database management requirements.

These costs are accepted as the platform grows.

---

# Future Architecture Direction

The target architecture:

```text
Web Application

Mobile Application

Admin Panel

        |
        v

API Gateway

        |
        v

Application Services

        |
        v

Domain Core

        |
        v

Database Layer
```

---

# Decision Summary

Madina Platform will introduce backend capabilities gradually while preserving the existing domain architecture.

The migration path allows CRM v1 to evolve into a full ERP platform without unnecessary rewrites.