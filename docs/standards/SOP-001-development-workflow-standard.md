# SOP-001: Development Workflow Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standard development workflow for Madina Platform.

The goal is to ensure:

- predictable development process;
- stable code quality;
- controlled changes;
- architectural consistency;
- reliable releases.

---

# Scope

This standard applies to:

- application development;
- bug fixes;
- refactoring;
- documentation updates;
- architectural changes.

---

# Development Principles

## 1. Verify Before Changing

Before modifying any code:

- inspect the current file;
- confirm existing implementation;
- understand dependencies.

Rule:

```text
Do not change unknown code.
```

---

## 2. Small Controlled Changes

Changes should be implemented incrementally.

Preferred:

```text
Small change

      |

      v

Build

      |

      v

Test

      |

      v

Commit
```

Avoid:

- large uncontrolled rewrites;
- unrelated changes;
- unnecessary refactoring.

---

# Development Workflow

## Step 1: Analyze Task

Before implementation:

- define the goal;
- identify affected modules;
- check architecture decisions;
- review existing code.

---

## Step 2: Inspect Current State

Required checks:

```text
Current file content

Current dependencies

Current tests

Current data contracts
```

The existing architecture must be preserved unless a planned migration is approved.

---

## Step 3: Implement Change

Development rules:

- follow TypeScript standards;
- reuse existing components;
- respect domain boundaries;
- avoid duplicate logic;
- keep backward compatibility.

---

## Step 4: Validate

After significant changes:

Run:

```bash
npm run build
```

or:

```bash
pnpm build
```

The build must pass before continuing.

---

## Step 5: Testing

Required validation:

Unit tests:

```text
Business logic validation
```

End-to-end tests:

```text
User workflow validation
```

Before release:

```bash
pnpm e2e
```

---

# Git Workflow

## Branch Strategy

Current strategy:

```text
main
 |
 +-- stable development branch
```

Future expansion:

```text
main

 |

 +-- feature branches

 +-- bugfix branches

 +-- release branches
```

---

# Commit Standards

Commits should describe the purpose.

Format:

```text
type(scope): description
```

Examples:

```text
feat(crm): add purchase workflow

fix(ui): correct modal behavior

docs(adr): add architecture decision

test(crm): cover persistence failure
```

---

# Pull and Review Rules

Before merging:

Check:

- build success;
- tests passed;
- no unexpected changes;
- documentation updated if needed.

---

# Documentation Requirements

Changes affecting architecture require documentation.

Examples:

New architecture decision:

```text
ADR document
```

Operational process:

```text
SOP document
```

Release milestone:

```text
Readiness document
```

---

# AI-Assisted Development Rules

AI tools may assist with:

- code generation;
- analysis;
- documentation;
- debugging.

However:

The developer remains responsible for:

- reviewing generated code;
- understanding changes;
- validating behavior;
- maintaining architecture quality.

---

# Quality Gates

Every significant change should pass:

```text
Code Review

      |

      v

Build

      |

      v

Tests

      |

      v

Documentation Check
```

---

# Release Preparation

Before release:

Required:

```text
Build        PASS

Tests        PASS

Git Status   CLEAN

Documentation UPDATED
```

---

# Emergency Fixes

For urgent fixes:

Priority:

1. Restore service stability.
2. Apply minimal change.
3. Validate behavior.
4. Document afterwards.

---

# Long-Term Goal

This workflow supports the evolution of Madina Platform from CRM v1 into a reliable ERP ecosystem.

The standard ensures:

- maintainability;
- scalability;
- predictable delivery;
- architectural discipline.