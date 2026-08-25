# SOP-012: Database Design and Migration Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standards for designing, evolving and maintaining databases and data storage systems in Madina Platform.

The goal is to ensure:

- reliable data structures;
- safe schema evolution;
- predictable migrations;
- data integrity;
- long-term scalability.

---

# Scope

This standard applies to:

- CRM data storage;
- ERP databases;
- backend databases;
- local-first storage;
- migration processes;
- data models.

---

# Database Principles

## 1. Data Structure Is Business Structure

Database design must reflect real business processes.

Example:

```text
Customer

    |

    v

Sales

    |

    v

Transactions
```

---

## 2. Data Integrity First

The database must protect correctness.

Requirements:

- valid relationships;
- consistent states;
- controlled updates;
- validation rules.

---

## 3. Evolution Without Destruction

Database changes must support gradual evolution.

Principle:

```text
Add

before

Remove
```

---

# Current Architecture

Madina Platform currently follows a local-first approach.

Current:

```text
Application

      |

      v

Local Storage

      |

      v

Business Operations
```

Future:

```text
Application

      |

      v

API Layer

      |

      v

Database Server

      |

      v

Infrastructure
```

Related:

```text
ADR-002-local-first-data-architecture.md
```

---

# Data Modeling Principles

## Entity-Based Design

Business objects should have clear entities.

Examples:

```text
Client

Product

Sale

Purchase

Transaction

Task
```

---

## Entity Ownership

Each module owns its data responsibility.

Example:

```text
Products Module

owns:

- products
- inventory


Sales Module

owns:

- sales
- revenue
```

---

# Database Naming Standards

Names should be clear and consistent.

Preferred:

```text
clients

products

sales

transactions
```

Avoid:

```text
tbl_clients

data_products
```

unless required by specific technology.

---

# Table Design Principles

Tables should:

- represent one responsibility;
- avoid unnecessary duplication;
- have clear relationships.

---

# Primary Keys

Every entity should have a unique identifier.

Example:

```text
id
```

Requirements:

- unique;
- stable;
- immutable.

---

# Relationships

Relationships must represent business rules.

Examples:

```text
Client

   |

   +---- Sales

   +---- Transactions
```

---

# Data Types

Choose appropriate data types.

Examples:

```text
ID       -> string/UUID

Quantity -> number

Date     -> timestamp

Status   -> enum
```

---

# Status Fields

Business states should use controlled values.

Example:

```text
draft

completed

cancelled
```

Avoid uncontrolled text values.

---

# Migration Principles

Database changes require migration planning.

Process:

```text
Analyze Change

        |

        v

Create Migration

        |

        v

Test Migration

        |

        v

Apply Migration

        |

        v

Verify Result
```

---

# Migration Safety

Before important migrations:

Required:

```text
Backup

Testing

Rollback Plan
```

---

# Migration Types

## Additive Migration

Adding:

- tables;
- columns;
- indexes.

Usually safer.

---

## Structural Migration

Changing:

- relationships;
- data format;
- architecture.

Requires careful review.

---

## Data Migration

Changing existing records.

Requires:

- validation;
- backup;
- verification.

---

# Backward Compatibility

Database changes should consider existing application versions.

Preferred:

```text
Old Version

+

New Version

=

Safe Transition
```

---

# Transaction Management

Critical operations should maintain consistency.

Example:

Sale completion:

```text
Create Sale

      |

      v

Update Stock

      |

      v

Create Transaction
```

All steps should succeed together.

---

# Data Validation

Before saving data:

Validate:

- required fields;
- formats;
- business rules;
- relationships.

---

# Indexing Strategy

Indexes should improve performance.

Consider:

- frequently searched fields;
- reporting queries;
- relationships.

Avoid unnecessary indexes.

---

# Data Integrity Rules

Important rules:

- no orphan records;
- valid relationships;
- predictable states;
- controlled deletion.

---

# Deletion Strategy

Critical business data should not be removed without consideration.

Preferred:

```text
Active

        |

        v

Archived

        |

        v

Deleted (if allowed)
```

---

# Audit Considerations

Important data changes should be traceable.

Examples:

- price changes;
- stock adjustments;
- financial changes.

Related:

```text
ADR-008-audit-logging-business-traceability.md
```

---

# Multi-Company Preparation

Future ERP mode requires company separation.

Data model should support:

```text
Company

    |

    +---- Users

    +---- Products

    +---- Sales

    +---- Transactions
```

Related:

```text
ADR-009-multi-company-multi-tenant-strategy.md
```

---

# Backup Relationship

Database backups must follow:

```text
Create Backup

        |

        v

Store Securely

        |

        v

Test Restore
```

Related:

```text
SOP-005-data-management-and-backup-standard.md
```

---

# Testing Database Changes

Database changes require validation.

Possible checks:

```text
Migration Test

Data Validation

Application Test

Rollback Test
```

---

# Documentation Requirements

Database changes should update:

- architecture documents;
- migration notes;
- API documentation if required.

---

# Change Management

Database changes follow:

```text
Request

   |

   v

Impact Analysis

   |

   v

Implementation

   |

   v

Validation
```

Related:

```text
SOP-008-change-management-standard.md
```

---

# Database Security

Protect:

- access credentials;
- sensitive information;
- backups.

Related:

```text
SOP-004-security-and-access-management-standard.md
```

---

# Database Checklist

Before migration:

```text
[ ] Change reviewed

[ ] Backup created

[ ] Migration tested

[ ] Rollback prepared

[ ] Data verified
```

---

# Responsibilities

## Developers

Responsible for:

- correct schema changes;
- migration quality;
- validation.

---

## System Owners

Responsible for:

- database strategy;
- reliability;
- recovery planning.

---

# Long-Term Goal

Database standards allow Madina Platform to evolve from CRM v1 local storage into a scalable ERP data platform.

The objective:

```text
Reliable Data Model

        |

        v

Safe Evolution

        |

        v

Scalable ERP Foundation
```