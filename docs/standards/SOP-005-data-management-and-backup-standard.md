# SOP-005: Data Management and Backup Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standards for managing, protecting and maintaining business data inside Madina Platform.

The goal is to ensure:

- data integrity;
- data consistency;
- safe evolution of the data model;
- reliable backup and recovery;
- preparation for future ERP scale.

---

# Scope

This standard applies to:

- CRM data;
- ERP business data;
- local-first storage;
- future backend databases;
- migrations;
- backups;
- data recovery processes.

---

# Data Management Principles

## 1. Data Is a Core Business Asset

Business data represents operational value.

Examples:

- clients;
- products;
- inventory;
- sales;
- purchases;
- financial transactions.

Principle:

```text
Protect the data that runs the business.
```

---

## 2. Data Integrity First

All operations must preserve data correctness.

Examples:

```text
Sale completion

        |

        v

Stock update

        |

        v

Financial record
```

A business operation must not create inconsistent states.

---

## 3. Controlled Data Changes

Changes to data structures must be planned.

Examples:

- new fields;
- changed relationships;
- new entities;
- removed attributes.

Required:

```text
Analyze

   |

   v

Document

   |

   v

Implement

   |

   v

Validate
```

---

# Current Data Architecture

Madina Platform currently follows a local-first approach.

Architecture:

```text
Application

      |

      v

Local Persistence

      |

      v

Business Operations
```

Future evolution:

```text
Application

      |

      v

API Layer

      |

      v

Database

      |

      v

Cloud Infrastructure
```

---

# Data Ownership

Each business module owns its domain data.

Examples:

```text
Clients Module

owns:

- client information


Products Module

owns:

- product information
- inventory state


Sales Module

owns:

- sales documents
- revenue records
```

---

# Data Model Evolution

Changes to the data model require:

- compatibility consideration;
- migration planning;
- validation.

---

# Migration Principles

Database or storage migrations should follow:

```text
Migration Planning

        |

        v

Backup

        |

        v

Migration Execution

        |

        v

Validation
```

---

# Backward Compatibility

Changes should avoid unnecessary breaking changes.

Preferred approach:

```text
Add

before

Remove
```

Example:

Instead of removing a field immediately:

```text
old_field

      +

new_field
```

migrate gradually.

---

# Local-First Data Rules

The current CRM uses local persistence.

Requirements:

- predictable storage behavior;
- validation before saving;
- protection against partial updates;
- consistent state.

---

# Transaction Safety

Critical business operations require safe execution.

Examples:

## Sale

```text
Create Sale

      |

Validate Stock

      |

Update Inventory

      |

Create Income Record
```

---

## Purchase

```text
Create Purchase

      |

Update Inventory

      |

Create Expense Record
```

---

# Backup Strategy

Important data requires regular backup procedures.

Backup goals:

- prevent data loss;
- support recovery;
- maintain business continuity.

---

# Backup Principles

A good backup must be:

## Regular

Created according to a defined schedule.

---

## Verified

Restore process must be tested.

---

## Recoverable

Data must be usable after restoration.

---

# Backup Lifecycle

```text
Create Backup

      |

      v

Store Backup

      |

      v

Verify Backup

      |

      v

Restore Test
```

---

# SQLite Operational Backup and Offline Restore Runbook

This runbook applies to the current server-backed SQLite database.

## Security and Storage

- Set `DATABASE_FILE` to the absolute production database path.
- Set `MADINA_BACKUP_DIR` to an absolute directory outside the repository and outside synchronized or shared folders.
- Backups contain business data, password hashes, salts, and active session records. Treat every backup as a security-sensitive artifact.
- Do not commit backups to Git or print their contents in logs.

## Verified Backup

Create a verified online backup with:

```powershell
$env:DATABASE_FILE = 'C:\absolute\path\madina.sqlite'
$env:MADINA_BACKUP_DIR = 'C:\absolute\path\madina-backups'
pnpm --filter server db:backup
```

The command requires an existing source database, validates source and backup with `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and never overwrites an existing backup. It creates collision-safe files named `madina-YYYYMMDDTHHMMSSZ.sqlite`, with a numeric suffix when needed.

## Deployment and Migration Order

1. Stop or quiesce the server.
2. Run `pnpm --filter server db:check` against the production database.
3. Run `pnpm --filter server db:backup`.
4. Deploy the application; startup applies and verifies migrations.
5. Run `db:check` again.
6. Start and confirm the server.

Do not automate migration rollback by replacing the database from a backup.

## Controlled Offline Restore

There is intentionally no restore CLI. Restore only while the server is stopped.

1. Record the absolute `DATABASE_FILE` and select a verified backup.
2. Run `db:check` with `DATABASE_FILE` set to the backup.
3. Preserve the current production database as a separate recovery copy; do not overwrite it before backup validation.
4. Replace the production database file only while the server is offline.
5. Start the application once so `initializeDatabase` applies any later migrations.
6. Run `db:check` against the restored production database.
7. Start and confirm the server only after successful validation.

This procedure assumes the current SQLite `DELETE` journal mode. It must be revised before any future WAL activation because WAL and SHM sidecar files need coordinated handling.

## Legacy Browser Migration Markers

Restoring an old or empty server database while a browser retains a `done` legacy migration marker can skip Clients, Tasks, or Commerce import. Do not reset browser markers automatically and do not treat an old browser snapshot as an unconditional recovery source. Prefer restoring a verified server backup; use a controlled, per-browser recovery procedure only after validating the legacy data.

---

# Recovery Strategy

In case of data failure:

Steps:

1. Identify the problem.
2. Stop harmful operations.
3. Restore last valid backup.
4. Verify data consistency.
5. Resume operations.
6. Document incident.

---

# Data Validation

All important data operations should validate:

- required fields;
- data types;
- business rules;
- relationships.

---

# Financial Data Protection

Financial records require additional care.

Examples:

- sales;
- purchases;
- income;
- expenses;
- transactions.

Rules:

- avoid silent modification;
- preserve history;
- maintain traceability.

---

# Audit Relationship

Important data changes should be traceable.

Related document:

```text
ADR-008-audit-logging-business-traceability.md
```

Future implementation:

```text
Data Change

      |

      v

Audit Event

      |

      v

Business History
```

---

# Multi-Company Data Preparation

Future ERP mode requires company isolation.

Data model should support:

```text
Company

      |

      v

Users

      |

      v

Business Data
```

Related document:

```text
ADR-009-multi-company-multi-tenant-strategy.md
```

---

# Data Security

Data protection includes:

- access control;
- encryption where required;
- secure backups;
- controlled exports.

---

# Data Export

Exports should be:

- authorized;
- documented;
- traceable.

---

# Data Quality Checklist

Before important changes:

```text
[ ] Data model reviewed

[ ] Migration considered

[ ] Backup available

[ ] Validation added

[ ] Recovery plan prepared
```

---

# Responsibilities

Developers and system owners are responsible for:

- protecting data integrity;
- documenting changes;
- following migration rules;
- maintaining recovery capability.

---

# Long-Term Goal

This standard supports the evolution of Madina Platform from a local-first CRM into a scalable ERP platform.

The objective:

```text
Reliable Data

      |

      v

Reliable Operations

      |

      v

Trusted Business Platform
```
