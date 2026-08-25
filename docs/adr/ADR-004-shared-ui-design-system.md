# ADR-004: Shared UI Design System

## Status

Accepted

## Date

2026-08-26

---

# Context

Madina Platform is designed as a multi-application ecosystem.

Future products may include:

- CRM;
- ERP modules;
- mobile applications;
- administration panels;
- customer-facing applications.

To maintain a consistent user experience and reduce duplicated code, the interface layer requires a shared design system.

Without a shared UI foundation, applications may develop:

- different visual styles;
- duplicated components;
- inconsistent user interactions;
- higher maintenance costs.

---

# Decision

Madina Platform uses a centralized shared UI package.

Location:

```text
packages/ui
```

The package provides reusable interface components used by applications.

Current responsibility:

```text
packages/ui

Responsible for:
- reusable components
- design tokens
- visual consistency
- interaction patterns
```

---

# UI Architecture

The application structure follows:

```text
Application Layer

apps/crm

        |
        v

Shared UI Layer

packages/ui

        |
        v

Design Foundation

tokens / styles / components
```

---

# Shared Components

The UI package contains reusable components.

Current components include:

```text
Button
Modal
Input
Textarea
Select
Table
Card
Badge
Toast
Tooltip
Drawer
DropdownMenu
FormField
DatePicker
Pagination
Tabs
```

Components should be reused instead of recreated inside individual applications.

---

# Design Tokens

The design system uses centralized tokens for:

- colors;
- spacing;
- typography;
- borders;
- radius;
- shadows.

Example:

```text
packages/ui/src/tokens/

colors.css
spacing.css
typography.css
radius.css
shadows.css
```

Tokens provide consistent visual language across Madina Platform.

---

# Architectural Rules

## Rule 1: UI Components Are Shared Assets

Application teams should prefer:

```text
import from @madina/ui
```

instead of creating local copies.

---

## Rule 2: Business Logic Does Not Belong In UI Components

UI components are responsible for:

- presentation;
- user interaction;
- accessibility.

They should not contain:

- business calculations;
- domain rules;
- data persistence.

---

## Rule 3: Applications Consume The Design System

Applications:

```text
apps/crm
apps/admin
apps/mobile
```

consume shared UI components.

The design system remains independent from specific products.

---

# Accessibility Requirements

Shared components must consider:

- keyboard navigation;
- focus management;
- semantic HTML;
- screen reader compatibility;
- predictable interaction behavior.

Example:

Modal components must:

- trap focus;
- restore focus after closing;
- support keyboard escape behavior.

---

# Consequences

## Positive

Benefits:

- consistent user experience;
- faster feature development;
- less duplicated code;
- easier maintenance;
- easier product expansion.

---

## Negative

Costs:

- additional initial structure;
- component API decisions require discipline;
- changes must consider all consumers.

These costs are accepted for long-term platform development.

---

# Future Evolution

The UI system can evolve with:

- theme support;
- localization;
- mobile design patterns;
- accessibility improvements;
- advanced component documentation.

Future applications should continue using the same design foundation.

---

# Decision Summary

Madina Platform uses a shared UI design system through `packages/ui`.

This ensures consistent experience, reusable components and scalable product development.