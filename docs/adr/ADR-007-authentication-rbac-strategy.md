# ADR-007: Authentication and RBAC Strategy

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform CRM v1 currently operates as a single-user local-first application.

At this stage:

- authentication is not required;
- user management is not implemented;
- access control is not enabled.

However, future ERP usage requires secure multi-user operation.

Potential users:

- business owners;
- managers;
- sales employees;
- warehouse employees;
- accountants;
- administrators.

The platform needs a clear security architecture before introducing backend services and multi-company capabilities.

---

# Decision

Madina Platform will introduce authentication and role-based access control (RBAC) as a future security foundation.

Authentication and authorization will be separated.

Principle:

```text
Authentication

Who is the user?

        |

        v

Authorization

What can the user do?
```

---

# Authentication Strategy

Authentication will be responsible for user identity.

Future responsibilities:

- user accounts;
- login process;
- session management;
- password/security policies;
- identity verification.

Possible future integrations:

- email authentication;
- phone authentication;
- enterprise identity providers.

---

# Authorization Strategy

Authorization will control access to platform capabilities.

The system will use role-based access control.

Structure:

```text
User

 |

 v

Role

 |

 v

Permissions

 |

 v

Application Modules
```

---

# Initial Role Model

Future standard roles:

## Owner

Full platform access.

Permissions:

- manage company settings;
- manage users;
- access all modules;
- view all reports.

---

## Manager

Business operation management.

Permissions:

- manage clients;
- manage sales;
- manage purchases;
- view reports.

---

## Sales Employee

Sales operations.

Permissions:

- create sales;
- manage customers;
- view assigned information.

---

## Warehouse Employee

Inventory operations.

Permissions:

- manage products;
- update stock;
- process warehouse movements.

---

## Accountant

Financial operations.

Permissions:

- view transactions;
- manage financial records;
- access reports.

---

# Permission Model

Permissions should be defined by actions, not only by screens.

Example:

```text
clients.create

clients.update

sales.create

sales.complete

inventory.adjust

reports.view
```

This allows flexible access management.

---

# Security Architecture

Future architecture:

```text
User

 |

 v

Authentication Service

 |

 v

Authorization Layer

 |

 v

API Gateway

 |

 v

Application Modules
```

---

# Domain Protection Principle

Security rules must not replace business rules.

Example:

Authorization decides:

```text
Can this user complete a purchase?
```

Domain logic decides:

```text
Is this purchase valid according to business rules?
```

Both layers are required.

---

# Consequences

## Positive

Benefits:

- secure multi-user operation;
- controlled access;
- enterprise readiness;
- better audit capabilities;
- support for SaaS model.

---

## Negative

Costs:

- additional complexity;
- user management requirements;
- security maintenance.

These costs are accepted for future ERP expansion.

---

# Future Evolution

Security capabilities will expand with:

- multi-company support;
- audit logs;
- activity tracking;
- advanced permission policies;
- security monitoring.

---

# Decision Summary

Madina Platform will introduce authentication and RBAC gradually after the CRM v1 foundation.

The security model will be designed around users, roles and permissions while preserving existing domain architecture.