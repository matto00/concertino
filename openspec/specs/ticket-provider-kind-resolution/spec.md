# ticket-provider-kind-resolution Specification

## Purpose
Documents that `lib/ui/ticket-provider.js`'s `kindFor`/`moduleFor` `kind` resolution is safe against prototype-chain lookups, so a hand-written `constructor`/`toString`/`hasOwnProperty`/`__proto__` kind is always treated as unknown rather than silently resolving to an inherited `Object.prototype` member.
## Requirements
### Requirement: `ticket-provider.js`'s `kind` resolution is safe against prototype-chain lookups

`lib/ui/ticket-provider.js`'s `kindFor` and `moduleFor` SHALL treat a `ticketProvider.kind` of `constructor`, `toString`, `hasOwnProperty`, or `__proto__` as an unresolved alias / unknown provider kind, never as a hit that resolves to an inherited `Object.prototype` member or method.

#### Scenario: `kindFor` does not resolve a prototype-chain kind through ALIASES
- **WHEN** `kindFor` is called with a config whose `ticketProvider.kind` is
  `constructor`, `toString`, `hasOwnProperty`, or `__proto__`
- **THEN** it returns that same raw value unresolved (no alias applied),
  never an inherited `Object.prototype` member

#### Scenario: `moduleFor` throws its loud unknown-kind error for a prototype-chain kind
- **WHEN** `moduleFor` is called with a config whose `ticketProvider.kind` is
  `constructor`, `toString`, `hasOwnProperty`, or `__proto__`
- **THEN** it throws the same loud "unknown kind" gate error it throws for
  any other unrecognized kind, rather than returning an inherited
  `Object.prototype` member as though it were a provider module

