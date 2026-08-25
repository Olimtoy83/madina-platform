# SOP-010: Environment and Configuration Management Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standards for managing development environments, system configuration and deployment settings for Madina Platform.

The goal is to ensure:

- consistent development environments;
- predictable deployments;
- secure configuration management;
- reduced environment-related issues;
- easier onboarding of developers.

---

# Scope

This standard applies to:

- local development;
- testing environments;
- staging environments;
- production environments;
- configuration files;
- environment variables;
- development tools.

---

# Environment Principles

## 1. Environment Consistency

All environments should follow the same core principles.

Principle:

```text
Development should represent production as closely as practical.
```

---

## 2. Configuration Separation

Application code and configuration must remain separate.

Example:

```text
Application Code

        +

Configuration

        |

        v

Running Environment
```

---

## 3. Secure Configuration

Sensitive configuration must never be stored inside source code.

Examples:

- passwords;
- API keys;
- tokens;
- private credentials.

---

# Environment Types

Madina Platform uses environment separation.

---

# Development Environment

Purpose:

Daily development and testing.

Contains:

- source code;
- local tools;
- development configuration.

Example:

```text
Developer Machine

        |

        v

Local Application
```

---

# Testing Environment

Purpose:

Validation before release.

Used for:

- automated tests;
- integration testing;
- quality verification.

---

# Staging Environment

Purpose:

Release preparation.

Should represent production behavior.

Used for:

- final verification;
- release candidate testing.

---

# Production Environment

Purpose:

Real business operations.

Requirements:

- stability;
- security;
- monitoring;
- controlled access.

---

# Development Tools

Project tooling should be documented.

Current Madina Platform stack:

```text
React

TypeScript

Vite

React Router

Turborepo

pnpm

Playwright
```

---

# Runtime Versions

Development environments should maintain compatible versions.

Example:

```text
Node.js Version

Package Manager Version

Framework Version
```

---

# Dependency Management

Dependencies must be controlled.

Rules:

- use approved versions;
- review updates;
- avoid unnecessary packages;
- test compatibility.

Related:

```text
SOP-009-code-quality-and-engineering-practices-standard.md
```

---

# Environment Variables

Configuration values should use environment variables.

Example:

```text
DATABASE_URL

API_URL

AUTH_SECRET
```

---

# Environment File Rules

Allowed:

```text
.env.example
```

Contains:

- variable names;
- required configuration structure.

Not allowed:

```text
.env

.env.production

secret files
```

inside repository.

---

# Configuration Changes

Configuration changes follow change management.

Process:

```text
Configuration Change

        |

        v

Review

        |

        v

Validation

        |

        v

Deployment
```

Related:

```text
SOP-008-change-management-standard.md
```

---

# Local Development Setup

A new developer should be able to:

```text
Clone Repository

        |

        v

Install Dependencies

        |

        v

Configure Environment

        |

        v

Run Application
```

---

# Build Environment

Build process must be reproducible.

Requirements:

- same dependency versions;
- documented commands;
- successful validation.

Example:

```bash
pnpm build
```

---

# Testing Environment

Testing should use controlled configuration.

Requirements:

- predictable data;
- isolated execution;
- repeatable results.

---

# Deployment Configuration

Deployments should define:

- environment;
- version;
- configuration;
- dependencies.

---

# Configuration Security

Security rules:

Never expose:

```text
Passwords

API Keys

Tokens

Private Certificates
```

---

# Secret Management

Future production systems should use secure secret storage.

Example:

```text
Secret Storage

        |

        v

Application Runtime

        |

        v

Secure Access
```

Related:

```text
SOP-004-security-and-access-management-standard.md
```

---

# Environment Troubleshooting

Common issues:

## Different Versions

Solution:

Check:

- Node version;
- package manager;
- dependencies.

---

## Configuration Error

Solution:

Check:

- environment variables;
- required settings;
- permissions.

---

## Build Difference

Solution:

Check:

- lock files;
- dependency versions;
- build commands.

---

# Backup Configuration

Configuration required for recovery should be documented.

Examples:

- deployment settings;
- infrastructure configuration;
- environment definitions.

---

# Change Tracking

Important environment changes should be traceable.

Record:

```text
What changed?

Who changed?

Why changed?

When changed?
```

---

# Production Access

Production access must be controlled.

Rules:

- authorized users only;
- minimum required permissions;
- activity traceability.

---

# Environment Checklist

Before deployment:

```text
[ ] Correct environment selected

[ ] Configuration verified

[ ] Secrets protected

[ ] Build successful

[ ] Tests passed

[ ] Version documented
```

---

# Responsibilities

## Developers

Responsible for:

- maintaining local environment;
- following configuration rules;
- documenting requirements.

---

## System Owners

Responsible for:

- environment security;
- access control;
- production stability.

---

# Long-Term Goal

Environment and configuration management enables Madina Platform to grow from CRM v1 into a reliable ERP ecosystem.

The objective:

```text
Consistent Environments

        |

        v

Reliable Releases

        |

        v

Stable Platform
```