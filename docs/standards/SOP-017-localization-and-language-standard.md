# SOP-017: Localization and Language Standard

## Status

Active

## Date

2026-08-26

---

# Purpose

This document defines the standards for localization and multilingual support inside Madina Platform.

The goal is to ensure:

- consistent multilingual experience;
- correct Arabic and RTL support;
- accurate business terminology;
- international readiness;
- scalable language management.

---

# Scope

This standard applies to:

- user interfaces;
- CRM modules;
- ERP modules;
- mobile interfaces;
- Telegram Mini Apps;
- reports;
- notifications;
- documentation.

---

# Localization Principles

## 1. Global Platform Design

Madina Platform should be designed as an international system.

Principle:

```
One Platform

      |

      v

Multiple Languages

      |

      v

Global Users
```

---

## 2. Language Separation

Application logic must not depend on a specific language.

Preferred:

```
Business Logic

        +

Translation Layer

        |

        v

Localized Interface
```

---

# Supported Languages

Initial target languages:

```text
Arabic

Russian

Uzbek
```

Future languages may be added.

---

# Arabic Language Support

Arabic is a primary language requirement for Madina Platform.

Requirements:

- correct Arabic text rendering;
- proper fonts;
- accurate translations;
- RTL compatibility.

---

# RTL Support

Arabic interfaces use Right-To-Left direction.

Example:

LTR:

```
Menu → Content
```

RTL:

```
Content ← Menu
```

---

# RTL Design Rules

RTL support must consider:

- layout direction;
- navigation;
- icons;
- tables;
- forms;
- alignment.

---

# UI Translation Rules

User-facing text should not be hardcoded.

Avoid:

```tsx
<button>
  Save
</button>
```

Preferred:

```text
translation key

        |

        v

localized value
```

---

# Translation Structure

Recommended structure:

```
locales/

 ├── ar/

 ├── ru/

 └── uz/
```

---

# Translation Keys

Keys should describe meaning.

Good:

```
sales.create_button
```

Avoid:

```
text1
button2
```

---

# Business Terminology

Translations must preserve business meaning.

Examples:

```
Sale

Purchase

Inventory

Transaction

Client
```

should have consistent translations.

---

# Currency Standards

Madina Platform primary currency:

```
SAR
```

Saudi Riyal formatting should be supported.

Examples:

```
100 SAR

1,500 SAR
```

---

# Number Formatting

Numbers should follow locale rules.

Consider:

- decimal separators;
- thousands separators;
- Arabic numerals where required.

---

# Date and Time Formatting

Dates should support localization.

Examples:

```
Arabic format

Russian format

International format
```

---

# Timezone Handling

Applications should consider timezone differences.

Required:

- store consistent timestamps;
- display according to user context.

For business and reporting calendar boundaries, Madina Platform uses the
authoritative IANA timezone `Asia/Riyadh`. Stored timestamps remain absolute
ISO instants; this timezone is used only when interpreting calendar periods.
Browser and server host timezones are not the business authority.

---

# Reports Localization

Reports should support:

- translated headers;
- localized dates;
- localized currency;
- language-specific formats.

---

# Notifications Localization

Notifications should support multiple languages.

Examples:

- system messages;
- alerts;
- confirmations;
- errors.

---

# Mobile Localization

Mobile interfaces must support:

- language switching;
- RTL layouts;
- readable text sizes.

Related:

```
SOP-016-mobile-and-responsive-design-standard.md
```

---

# API Localization

APIs should avoid language-dependent data structures.

Example:

Preferred:

```json
{
  "status": "completed"
}
```

Translation happens in the client.

---

# Database Localization

Database design should support multilingual data.

Examples:

```
Product

 ├── Arabic Name

 ├── Russian Name

 └── Uzbek Name
```

---

# Search Localization

Search should consider:

- different languages;
- character differences;
- Arabic text handling.

---

# Font Requirements

Fonts should support:

- Arabic characters;
- Latin characters;
- Cyrillic characters.

---

# Cultural Considerations

Localization includes more than translation.

Consider:

- language direction;
- date formats;
- currency;
- business habits;
- user expectations.

---

# Translation Quality

Translations should be:

- accurate;
- consistent;
- reviewed.

Avoid automatic translation without verification for important business terms.

---

# Language Switching

Users should be able to change language easily.

Example:

```
Settings

    |

    v

Language

    |

    v

Select Language
```

---

# Documentation Localization

Important documentation may require:

- English version;
- Russian version;
- Arabic version.

---

# Testing Requirements

Localization testing should verify:

```
[ ] Text displays correctly

[ ] RTL works correctly

[ ] No missing translations

[ ] Dates are correct

[ ] Currency displays correctly

[ ] Mobile layout works
```

---

# Relationship With Design System

Localization must work together with UI components.

Related:

```
ADR-004-shared-ui-design-system.md
```

---

# Relationship With Architecture

International support should be considered during architecture decisions.

Related:

```
ADR-003-domain-module-boundaries.md
```

---

# Responsibilities

## Developers

Responsible for:

- localization implementation;
- translation keys;
- RTL support.

---

## Product Owners

Responsible for:

- terminology;
- language priorities;
- user requirements.

---

## Reviewers

Responsible for:

- translation quality;
- consistency.

---

# Long-Term Goal

Localization standards allow Madina Platform to serve users across different countries and languages.

The objective:

```
Arabic First

      +

International Ready

      |

      v

Global Business Platform
```
