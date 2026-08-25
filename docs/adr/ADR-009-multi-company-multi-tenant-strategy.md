# ADR-009: Multi-Company and Multi-Tenant Architecture Strategy

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform is designed to evolve from a single-business CRM into a scalable ERP platform.

The current CRM v1 operates with a single organization model.

Future platform usage may include:

- multiple companies;
- multiple business owners;
- independent teams;
- separate warehouses;
- isolated financial records.

The platform must define a strategy for separating business data before backend implementation.

---

# Decision

Madina Platform will support a multi-company architecture in future versions.

Each company will operate as an independent business entity inside the platform.

The system will use a tenant-based data isolation approach.

Concept:

```text
Platform

   |

   +-- Company A
   |
   |    +-- Users
   |    +-- Products
   |    +-- Sales
   |    +-- Purchases
   |    +-- Transactions
   |
   |
   +-- Company B
        |
        +-- Users
        +-- Products
        +-- Sales
        +-- Reports
```

---

# Terminology

## Platform

The complete Madina Platform system.

---

## Tenant

An isolated business environment inside the platform.

Usually represents:

- company;
- organization;
- business owner account.

---

## Company

A legal or operational business entity.

Examples:

- retail business;
- warehouse operation;
- trading company.

---

## User

A person who accesses the platform.

A user belongs to one or more companies depending on permissions.

---

# Data Isolation Principle

Business data must always belong to a company.

Future entity structure:

```text
Company

 |

 +-- Users

 |

 +-- Products

 |

 +-- Sales

 |

 +-- Purchases

 |

 +-- Transactions
```

Every business record should contain:

```text
companyId
```

Example:

```text
Product

id:
PROD-001

companyId:
COMPANY-001

name:
Premium Dates
```

---

# Tenant Isolation Rules

The platform must guarantee:

- users cannot access another company's data;
- reports show only authorized company information;
- inventory remains isolated;
- financial records remain separated.

---

# Authorization Integration

Multi-company support works together with RBAC.

Example:

```text
User

 |

 v

Company Membership

 |

 v

Role

 |

 v

Permissions
```

Example:

```text
Ahmad

Company:
Madina Dates Trading

Role:
Warehouse Manager

Permissions:
Inventory Management
```

---

# Future Backend Model

After backend introduction:

```text
Frontend

    |

    v

API Layer

    |

    v

Tenant Resolution

    |

    v

Business Services

    |

    v

Database
```

The backend will determine the active company context for every request.

---

# Database Strategy

Future database design should support:

Option A:

Shared database with company isolation:

```text
companies

users

products

sales

transactions
```

with:

```text
company_id
```

---

Option B:

Separate database per company.

```text
Company A Database

Company B Database

Company C Database
```

---

Initial recommendation:

Start with shared database and strict tenant isolation.

Migration to separated databases remains possible.

---

# SaaS Readiness

Multi-company architecture enables future capabilities:

- subscription plans;
- company onboarding;
- billing;
- customer accounts;
- cloud deployment.

Example:

```text
Free Plan

   |
   +-- 1 Company
   +-- Limited Users


Business Plan

   |
   +-- Multiple Companies
   +-- Unlimited Users
```

---

# Consequences

## Positive

Benefits:

- scalable ERP foundation;
- secure business separation;
- SaaS readiness;
- support for multiple customers;
- future marketplace opportunities.

---

## Negative

Costs:

- additional data complexity;
- more authorization rules;
- more testing requirements.

These costs are accepted for long-term platform growth.

---

# Migration Strategy

Current CRM v1:

```text
Single Company
```

Future evolution:

```text
CRM v2

      |

      v

Company Context Layer

      |

      v

Multi-Company ERP Platform
```

Migration should avoid rewriting existing domain modules.

---

# Decision Summary

Madina Platform will evolve toward a multi-company architecture where each organization operates in an isolated business environment.

The design prepares the platform for future ERP expansion and SaaS capabilities while preserving the existing CRM foundation.