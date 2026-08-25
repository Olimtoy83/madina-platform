# SOP-003: Release Management Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standard process for preparing, validating and releasing Madina Platform versions.

The goal is to ensure:

- predictable releases;
- stable deployments;
- controlled changes;
- reliable rollback capability;
- transparent version history.

---

# Scope

This standard applies to:

- CRM releases;
- future ERP releases;
- application updates;
- infrastructure changes;
- documentation releases.

---

# Release Principles

## 1. Stability First

A release must prioritize system reliability.

Rule:

```text
No release without validation.
```

---

## 2. Traceable Changes

Every release must be connected to:

- Git commits;
- documentation;
- tests;
- version information.

---

## 3. Incremental Delivery

Releases should be small and controlled.

Preferred:

```text
Small Changes

      |

      v

Validation

      |

      v

Release
```

---

# Release Lifecycle

The release process:

```text
Development

      |

      v

Code Review

      |

      v

Build Verification

      |

      v

Testing

      |

      v

Release Candidate

      |

      v

Production Release

      |

      v

Monitoring
```

---

# Release Types

## Patch Release

Used for:

- bug fixes;
- small corrections;
- security fixes.

Example:

```text
v1.0.1
```

---

## Minor Release

Used for:

- new features;
- module improvements;
- backward-compatible changes.

Example:

```text
v1.1.0
```

---

## Major Release

Used for:

- architectural changes;
- breaking changes;
- major platform evolution.

Example:

```text
v2.0.0
```

---

# Release Preparation

Before creating a release:

Check:

```text
Code completed

Documentation updated

Build successful

Tests passed

Git status clean
```

---

# Build Verification

Required command:

```bash
pnpm build
```

Expected result:

```text
Build successful
```

A failed build blocks the release.

---

# Testing Verification

Required tests:

## Unit Tests

Validate:

- domain logic;
- calculations;
- services.

---

## End-to-End Tests

Validate:

- user workflows;
- critical operations;
- persistence behavior.

Command:

```bash
pnpm e2e
```

Expected:

```text
All tests passed
```

---

# Release Candidate

Before final release:

Create release candidate:

```text
Version Candidate

Example:

v1.0.0-rc.1
```

Validate:

- application behavior;
- documentation;
- deployment process.

---

# Version Management

Versions follow:

```text
MAJOR.MINOR.PATCH
```

Example:

```text
1.0.0
```

Meaning:

```text
1 = major architecture version

0 = feature version

0 = bug fix version
```

---

# Git Release Process

Release workflow:

```text
Commit Changes

      |

      v

Update Version

      |

      v

Create Git Tag

      |

      v

Push Tag

      |

      v

Release
```

Example:

```bash
git tag v1.0.0

git push origin v1.0.0
```

---

# Release Documentation

Each important release should include:

- version number;
- release date;
- new features;
- fixes;
- known limitations.

Example:

```text
CRM v1.0.0

Features:

- Sales module
- Purchase module
- Inventory tracking

Validation:

- Build PASS
- E2E PASS
```

---

# Rollback Strategy

If a release causes critical issues:

Actions:

1. Stop further deployment.
2. Identify affected version.
3. Restore previous stable version.
4. Document incident.

Principle:

```text
Stable recovery is more important than speed.
```

---

# Production Monitoring

After release monitor:

- application errors;
- user reports;
- data consistency;
- performance.

---

# Emergency Release

For critical issues:

Process:

```text
Issue Detection

      |

      v

Minimal Fix

      |

      v

Validation

      |

      v

Emergency Release
```

Documentation may follow after stabilization.

---

# Release Checklist

Before release:

```text
[ ] Build passed

[ ] Tests passed

[ ] Documentation updated

[ ] Git status clean

[ ] Version prepared

[ ] Release notes prepared
```

---

# Responsibilities

The person preparing a release is responsible for:

- validation;
- documentation;
- version correctness;
- communication.

---

# Long-Term Goal

This release process supports the evolution of Madina Platform from CRM v1 into a stable ERP ecosystem.

The standard ensures controlled growth, predictable delivery and long-term maintainability.