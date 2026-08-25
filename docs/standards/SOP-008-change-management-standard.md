# SOP-008: Change Management Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standard process for planning, evaluating, implementing and controlling changes in Madina Platform.

The goal is to ensure:

- controlled system evolution;
- predictable changes;
- reduced technical risk;
- architectural consistency;
- long-term maintainability.

---

# Scope

This standard applies to:

- application changes;
- architecture changes;
- database changes;
- security changes;
- infrastructure changes;
- documentation changes.

---

# Change Management Principles

## 1. Every Change Has Impact

Before implementing important changes, the impact must be understood.

Principle:

```text
Small change

may have

large consequences.
```

---

## 2. Controlled Evolution

Madina Platform grows through planned improvements.

Preferred approach:

```text
Understand

    |

    v

Plan

    |

    v

Implement

    |

    v

Validate
```

---

## 3. Documentation Follows Decisions

Important changes must update related documentation.

Example:

```text
Architecture Change

        |

        v

ADR Update

        |

        v

Implementation

        |

        v

Release Documentation
```

---

# Change Types

## Standard Change

Low-risk repeated change.

Examples:

- minor UI correction;
- documentation update;
- small bug fix.

---

## Feature Change

Adds new business capability.

Examples:

- new CRM module;
- new workflow;
- new report.

---

## Architectural Change

Affects system structure.

Examples:

- new package;
- backend introduction;
- database migration;
- technology change.

Requires:

```text
ADR Review
```

---

## Emergency Change

Required to restore system operation.

Examples:

- critical bug fix;
- security correction;
- data recovery.

---

# Change Lifecycle

Standard lifecycle:

```text
Change Request

        |

        v

Impact Analysis

        |

        v

Approval Decision

        |

        v

Implementation

        |

        v

Testing

        |

        v

Release

        |

        v

Review
```

---

# Change Request

Important changes should contain:

```text
Title

Description

Reason

Expected Result

Affected Areas

Risk Level
```

---

# Impact Analysis

Before implementation evaluate:

## Technical Impact

Questions:

- Which modules change?
- Are dependencies affected?
- Is architecture affected?

---

## Business Impact

Questions:

- Which users are affected?
- Does workflow change?
- Is data affected?

---

## Security Impact

Questions:

- Are permissions affected?
- Are sensitive data involved?

---

# Risk Assessment

Changes are classified by risk.

## Low Risk

Examples:

- documentation;
- styling;
- isolated correction.

---

## Medium Risk

Examples:

- business logic change;
- new workflow;
- module extension.

---

## High Risk

Examples:

- database migration;
- authentication changes;
- architecture changes.

---

# Approval Rules

High-impact changes require review.

Examples:

```text
Architecture Change

        |

        v

ADR Review

        |

        v

Implementation
```

---

# Code Change Relationship

Every significant code change should have:

```text
Code

+

Tests

+

Documentation

```

---

# Database Change Rules

Database-related changes require:

- migration plan;
- backup consideration;
- validation;
- rollback strategy.

Related:

```text
SOP-005-data-management-and-backup-standard.md
```

---

# Security Change Rules

Security-related changes require:

- access review;
- permission validation;
- security impact analysis.

Related:

```text
SOP-004-security-and-access-management-standard.md
```

---

# Testing Requirements

Changes must be validated according to impact.

Possible validation:

```text
Build

Unit Tests

E2E Tests

Manual Verification
```

Related:

```text
ADR-005-testing-strategy-quality-gates.md
```

---

# Release Relationship

Approved changes enter release process.

Flow:

```text
Change

    |

    v

Implementation

    |

    v

Validation

    |

    v

Release
```

Related:

```text
SOP-003-release-management-standard.md
```

---

# Technical Debt Management

Technical debt should be visible and managed.

Examples:

- temporary solutions;
- outdated dependencies;
- duplicated logic.

Process:

```text
Identify

    |

    v

Document

    |

    v

Prioritize

    |

    v

Resolve
```

---

# Change Review

After implementation review:

Check:

```text
Was the goal achieved?

Was documentation updated?

Were risks controlled?

Are improvements needed?
```

---

# Change Records

Important changes should preserve history:

```text
Change

    |

    v

Commit

    |

    v

Release

    |

    v

Documentation
```

---

# Responsibilities

## Change Owner

Responsible for:

- describing change;
- evaluating impact;
- coordinating implementation.

---

## Developer

Responsible for:

- implementation;
- testing;
- technical quality.

---

## Reviewer

Responsible for:

- risk evaluation;
- architecture consistency;
- approval.

---

# Long-Term Goal

Change management enables Madina Platform to grow safely from CRM v1 into a scalable ERP ecosystem.

The objective:

```text
Controlled Changes

        |

        v

Stable Platform

        |

        v

Sustainable Growth
```