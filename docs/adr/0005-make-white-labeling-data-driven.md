# ADR-0005: Make white-labeling data-driven

## Status

Accepted

## Context

Grey Retention will be sold as a white-label product. Customers may need different names, logos, palettes, typography, domains, email identity, feature availability, and customer-facing copy. Maintaining code forks would make fixes and product evolution unsafe.

## Decision

Keep one codebase. Resolve an immutable tenant/brand presentation context at the server boundary and expose allowlisted design tokens, assets, copy keys, domains, and feature entitlements. Product behavior remains in shared domain modules; differences enter through validated configuration and entitlement policy.

## Consequences

### Positive

- One implementation receives fixes and new features.
- Tenant identity can change without redeployment or branching.
- Theme and entitlement behavior can be tested systematically.

### Negative

- Every shared UI surface must avoid hardcoded identity and color assumptions.
- Invalid or inaccessible tenant themes need validation and safe fallbacks.
- Custom domains and email identity introduce operational verification flows.

### Neutral

- Truly bespoke behavior requires a first-class extension point or product decision, not an ad hoc fork.

## Alternatives considered

- Repository or branch per customer: rejected due to drift, duplicated QA, and upgrade cost.
- CSS-only themes: rejected because white-label scope also includes copy, assets, domains, email identity, and feature policy.

## References

- `PRODUCT.md`
- `docs/SYSTEM_ARCHITECTURE.md`
