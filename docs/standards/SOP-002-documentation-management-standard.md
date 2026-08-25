# SOP-002: Documentation Management Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standard for creating, organizing, maintaining and reviewing documentation inside Madina Platform.

The goal is to ensure:

- consistent documentation structure;
- easy knowledge discovery;
- architectural transparency;
- long-term maintainability.

---

# Scope

This standard applies to:

- architecture documents;
- ADR records;
- SOP documents;
- technical references;
- project guidelines;
- release documentation.

---

# Documentation Principles

## 1. Documentation Is Part of the Product

Documentation is not an optional activity.

Important decisions, processes and system changes must be documented.

Principle:

```text
Code explains how.

Documentation explains why.
```

---

## 2. Single Source of Truth

Each document should have one primary location.

Avoid:

- duplicate documents;
- outdated copies;
- conflicting versions.

---

## 3. Documentation Must Evolve

Documentation should be updated when:

- architecture changes;
- workflows change;
- responsibilities change;
- important decisions are made.

---

# Documentation Structure

Current structure:

```text
docs/

├── architecture/

├── adr/

├── standards/

└── sprint/
```

---

# Document Categories

## Architecture Documents

Location:

```text
docs/architecture/
```

Purpose:

Describe the overall system structure.

Examples:

```text
ARCHITECTURE_OVERVIEW.md

CRM_V1_READINESS.md
```

---

## Architecture Decision Records (ADR)

Location:

```text
docs/adr/
```

Purpose:

Record important technical decisions.

Format:

```text
ADR-XXX-description.md
```

Examples:

```text
ADR-001-monorepo-architecture.md

ADR-010-integration-external-services-strategy.md
```

---

## Standard Operating Procedures (SOP)

Location:

```text
docs/standards/
```

Purpose:

Define operational processes.

Format:

```text
SOP-XXX-description.md
```

Examples:

```text
SOP-001-development-workflow-standard.md

SOP-002-documentation-management-standard.md
```

---

# ADR Management Rules

A new ADR should be created when a decision affects:

- architecture;
- technology selection;
- data strategy;
- security;
- scalability;
- integrations.

---

## ADR Lifecycle

```text
Proposal

   |

   v

Review

   |

   v

Accepted

   |

   v

Implemented

   |

   v

Archived (if replaced)
```

---

# SOP Management Rules

SOP documents describe repeatable processes.

Create SOP when:

- a workflow must be standardized;
- team consistency is required;
- operational knowledge must be preserved.

---

# Naming Convention

All documentation files should follow:

```text
TYPE-NUMBER-description.md
```

Examples:

```text
ADR-005-testing-strategy-quality-gates.md

SOP-001-development-workflow-standard.md
```

Rules:

- use lowercase descriptions;
- use hyphens;
- keep names descriptive;
- avoid spaces.

---

# Version Control Rules

Documentation changes must use Git.

Required workflow:

```text
Edit Document

      |

      v

Review Change

      |

      v

Commit

      |

      v

Push
```

---

# Commit Convention

Documentation commits:

```text
docs(type): description
```

Examples:

```text
docs(adr): add security strategy

docs(standards): update workflow standard
```

---

# Documentation Review

Before accepting changes:

Check:

- correct location;
- correct naming;
- clear purpose;
- no duplicate information;
- Markdown formatting.

---

# Relationship With Code

When code changes affect documented decisions:

Update documentation together with code.

Example:

```text
New authentication system

        |

        +-- Code changes

        |

        +-- ADR update

        |

        +-- SOP update
```

---

# Repository Documentation Strategy

Madina Platform uses multiple repositories.

Each repository should maintain its own technical documentation when required.

Example:

```text
madina-platform

    |
    +-- Application architecture


madina-barakasi-docs

    |
    +-- Business documentation


madina-arabic

    |
    +-- Application documentation
```

---

# Responsibilities

Documentation responsibility belongs to the person making the change.

The author must ensure:

- information accuracy;
- correct placement;
- updated references.

---

# Quality Standard

Good documentation should be:

- clear;
- concise;
- structured;
- searchable;
- maintained.

---

# Decision Summary

Madina Platform treats documentation as an essential engineering asset.

A structured documentation system ensures that architecture decisions, operational processes and technical knowledge remain available as the platform grows.