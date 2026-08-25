# ADR-003: Domain Module Boundaries

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform is designed as a long-term ERP platform, not only as a single CRM application.

As the system grows, business logic must remain maintainable and independent from the user interface.

Without clear module boundaries, the system risks:

- duplicated business rules;
- tightly coupled features;
- difficult testing;
- complicated future migration to backend services.

The architecture requires clear separation between:

- application layer;
- user interface layer;
- business domain layer;
- shared infrastructure.

---

# Decision

Madina Platform separates business capabilities into independent domain modules inside `packages/core`.

Current domain structure:

```text
packages/core/src/

clients/
inventory/
purchases/
sales/
tasks/
transactions/
reporting/
```

Each module owns its own:

- business rules;
- domain types;
- calculations;
- services;
- tests.

---

# Domain Responsibilities

## Clients Module

Responsible for customer management.

Includes:

- client entities;
- client validation;
- client operations;
- customer-related rules.

---

## Inventory Module

Responsible for warehouse and stock management.

Includes:

- products;
- stock calculations;
- stock movements;
- inventory integrity rules.

---

## Purchases Module

Responsible for procurement operations.

Includes:

- purchase documents;
- purchase calculations;
- supplier-related workflows;
- expense preparation.

---

## Sales Module

Responsible for sales operations.

Includes:

- sales documents;
- sale calculations;
- completion rules;
- income preparation.

---

## Tasks Module

Responsible for operational task management.

Includes:

- task entities;
- task lifecycle;
- task status management.

---

## Transactions Module

Responsible for financial records.

Includes:

- income records;
- expense records;
- financial tracking.

---

## Reporting Module

Responsible for business analytics preparation.

Includes:

- aggregation logic;
- reporting calculations;
- future dashboard support.

---

# Architectural Rules

## Rule 1: Domain Independence

Domain modules must not depend on React components or UI implementation.

Allowed:

```text
UI
 ↓
Application workflows
 ↓
Domain modules
```

Not allowed:

```text
Domain modules
 ↓
React components
```

---

## Rule 2: Business Logic Ownership

Business rules belong to domain modules.

Examples:

- stock validation;
- purchase completion rules;
- sales calculations;
- transaction creation.

UI components should only display and trigger actions.

---

## Rule 3: Module Isolation

A domain module should expose clear public contracts.

Other modules should interact through defined interfaces instead of accessing internal implementation details.

---

# Consequences

## Positive

Benefits:

- easier testing;
- clearer ownership;
- reduced complexity;
- safer feature expansion;
- preparation for backend migration.

---

## Negative

Costs:

- more initial structure;
- additional abstraction;
- need for discipline during development.

These costs are accepted because Madina Platform is designed for long-term growth.

---

# Future Evolution

The same domain boundaries can support future architecture:

```text
Frontend
   |
API Layer
   |
Application Services
   |
Domain Modules
   |
Database
```

Future systems can reuse existing business rules without rewriting the core logic.

---

# Decision Summary

Madina Platform uses domain-driven module boundaries to keep business logic independent, testable and ready for future ERP expansion.