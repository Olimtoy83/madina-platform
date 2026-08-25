# ADR-001: Monorepo Architecture

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform is planned as a scalable ERP/CRM ecosystem.

The project contains multiple applications and shared modules:

- CRM application
- business domain logic
- UI component system
- shared utilities
- future services

A traditional multi-repository approach would increase complexity:

- duplicated configurations
- difficult dependency management
- harder synchronization between modules
- slower development

The project requires a structure that allows independent growth while keeping a unified codebase.

---

# Decision

Madina Platform uses a monorepo architecture.

The repository contains multiple packages and applications managed together.

Current structure:

```text
madina-platform

apps/
  crm/

packages/
  core/
  shared/
  ui/

docs/
```

---

# Responsibilities

## apps/crm

Application layer.

Contains:

- pages
- layouts
- workflows
- application state
- user interaction logic

---

## packages/core

Domain layer.

Contains:

- business entities
- calculations
- validation
- business rules

The core package must remain independent from UI.

---

## packages/ui

Design system layer.

Contains:

- reusable components
- visual standards
- interface primitives

---

## packages/shared

Common utilities layer.

Contains:

- shared types
- helpers
- constants

---

# Consequences

## Positive

Advantages:

- unified development workflow
- shared code reuse
- consistent standards
- easier refactoring
- better scalability

---

## Negative

Trade-offs:

- larger repository
- more complex build management
- requires clear package boundaries

---

# Alternatives Considered

## Multiple repositories

Rejected because:

- increases maintenance overhead
- duplicates configuration
- complicates shared code management

---

# Result

The monorepo architecture provides a stable foundation for future Madina Platform ERP expansion.

The structure supports:

- CRM growth
- backend integration
- mobile applications
- enterprise features
- additional business modules