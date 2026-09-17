# agent-merge-protected-paths Specification

## Purpose
Lets a repository name path globs that the auditor may never merge on its own, so a change to the files that constrain the agents always reaches a human even when CI is green and every acceptance criterion is satisfied.

## Requirements

### Requirement: protectedPaths is a validated config field defaulting to empty
`agentMerge.protectedPaths` SHALL be an optional array of path-glob strings, schema-validated, defaulting to `[]` when unset. A project that does not set it SHALL observe behavior identical to before this capability existed. Each configured pattern SHALL be validated at `concertino sync`/`concertino validate`/`concertino doctor` time, and a pattern that is not a non-empty string SHALL be reported as a configuration error naming the offending index and value rather than being silently ignored.

#### Scenario: Unset field defaults to empty
- **WHEN** a project's `concertino.config.json` sets `agentMerge` without a `protectedPaths` key
- **THEN** the normalized config exposes `agentMerge.protectedPaths` as `[]`, and no protected-path check ever refuses a merge

#### Scenario: A configured array is preserved in order
- **WHEN** a project sets `agentMerge.protectedPaths` to a non-empty array of glob strings
- **THEN** the normalized config exposes exactly those strings, in the configured order

#### Scenario: The schema accepts the new field
- **WHEN** a config setting `agentMerge.protectedPaths` is validated against `config/concertino.schema.json`
- **THEN** validation succeeds, whereas before this capability the `agentMerge` block's `additionalProperties: false` rejected the key outright

#### Scenario: A non-string entry is a configuration error
- **WHEN** `agentMerge.protectedPaths` contains an entry that is not a string, or is an empty string
- **THEN** `collectConfigIssues` reports an error naming `agentMerge.protectedPaths[<index>]` and the offending value

#### Scenario: An empty-pattern entry cannot silently match everything
- **WHEN** `agentMerge.protectedPaths` contains `""`
- **THEN** it is rejected as a configuration error, because an empty glob pathspec matches every path in the tree and would make every merge refuse for a reason the operator did not intend

#### Scenario: An entry not recognizable as a plain relative glob is rejected by a positive allowlist, not a denylist of known-bad prefixes
- **WHEN** `agentMerge.protectedPaths` contains an entry that does not match a strict positive pattern for a plain relative glob — concretely: its first character is not alphanumeric, `.`, `_`, or `-`; or any remaining character falls outside the enumerated safe set (alphanumerics plus `._-/*?[]`); or it differs from its own whitespace-trimmed form; or it is empty after trimming; or it contains `..`; or it ends with `/`
- **THEN** `collectConfigIssues` reports an error naming `agentMerge.protectedPaths[<index>]` and the offending value, because an entry the accept pattern does not recognize as a plain glob may be git pathspec magic (a leading `!`, a leading `:` in any form) or otherwise behave unexpectedly when handed to git, and could silently disarm the check by matching nothing. This is deliberately an ALLOWLIST (a fixed accept pattern a new evasion shape must match to slip through) rather than a DENYLIST of specific prefixes discovered so far — a denylist enumerates evasions one at a time and is always one shape behind; a prior denylist version of this same requirement (`entry.startsWith('!') || entry.startsWith(':')`) was defeated by a leading-space entry (`" !record/**"`) that started with neither character

#### Scenario: A whitespace-differing entry is rejected outright, never silently trimmed and accepted
- **WHEN** `agentMerge.protectedPaths` contains an entry with leading, trailing, or embedded whitespace (for example `" !record/**"` or `"record/** "`)
- **THEN** the entry is rejected as a configuration error naming the index and value; it is never silently trimmed to a "corrected" form and accepted, since silent normalization in a safety guard would hide operator error

### Requirement: A protected-path match refuses the merge and names the matched paths
The pre-merge readiness check SHALL compare the run's diff against the review base to every configured `protectedPaths` glob. When one or more of the diff's paths match, the check SHALL refuse, SHALL name every matched path, and SHALL exit with a code distinct from both an ordinary condition failure and the stale-review outcome. When no configured glob matches, or when the list is empty, the check SHALL be silent and SHALL NOT affect the outcome.

#### Scenario: A diff touching a protected glob refuses
- **WHEN** `agentMerge.protectedPaths` contains a glob matching at least one path in the branch's diff against the review base, and all other merge conditions hold
- **THEN** the check refuses rather than printing `PASS`, and its output names each matched path

#### Scenario: The refusal names every matched path, not just the first
- **WHEN** the diff touches three paths matching configured globs
- **THEN** all three matched paths appear in the refusal output

#### Scenario: A diff touching no protected glob is unaffected
- **WHEN** `agentMerge.protectedPaths` is non-empty but no configured glob matches any path in the diff
- **THEN** the check's outcome is exactly what it would have been with the field unset, and it prints `PASS` when every other condition holds

#### Scenario: An empty protectedPaths list is a no-op
- **WHEN** `agentMerge.protectedPaths` is `[]` or absent
- **THEN** no protected-path comparison influences the result and no protected-path output is produced at all

#### Scenario: The protected-path outcome is distinguishable from other refusals
- **WHEN** the check refuses because of a protected-path match
- **THEN** its exit code differs from the exit code used for an ordinary condition failure and from the one used for a stale reviewed SHA, so a caller can route the three outcomes differently without parsing prose

### Requirement: Glob matching is delegated to git's pathspec engine
Pattern matching SHALL be performed by git's own `:(glob)` pathspec magic against the diff, rather than by a hand-rolled shell matcher. This SHALL give per-segment semantics in which `**` spans directories, a `*` inside a segment does not cross `/`, and a pattern without a leading path segment is anchored at the repository root.

#### Scenario: A double-star glob spans nested directories
- **WHEN** a configured glob is `record/**` and the diff touches `record/nested/deep/c.md`
- **THEN** that path is reported as matched

#### Scenario: A root-anchored filename does not match the same name in a subdirectory
- **WHEN** a configured glob is `CHARTER.md` and the diff touches only `docs/CHARTER.md`
- **THEN** no match is reported, because the pattern is anchored at the repository root

#### Scenario: A within-segment wildcard matches only within that segment
- **WHEN** a configured glob is `scripts/check-*.sh` and the diff touches `scripts/check-foo.sh` and `scripts/nested/check-bar.sh`
- **THEN** only `scripts/check-foo.sh` is reported as matched

### Requirement: A malformed glob or pathspec magic fails closed rather than silently matching nothing
A configured pattern that git's pathspec engine accepts but that cannot match anything as a plain glob — either because it is syntactically malformed (for example, a pattern containing an unclosed character class) or because it is not recognizable as a plain relative glob — SHALL NOT be allowed to silently reduce the guard to a no-op. Plain-glob recognition SHALL be defined by exactly ONE predicate (`isPlainRelativeGlob`), never by two independent reimplementations of the same rule, and SHALL be applied at BOTH the config-validation layer and the script's own condition-4 layer by having the script layer CALL the one predicate (via the same structured-config read it already performs) rather than re-derive an equivalent rule in shell. This constraint exists because two independent reimplementations of one predicate are observed to diverge: a first denylist-shaped implementation (rejecting only an entry beginning `!` or beginning `:`) was defeated by a leading-space entry (`" !record/**"`); a first allowlist-shaped implementation, correct in the abstract but reimplemented separately in shell using a bash `[[ =~ ]]` character-class test, was defeated by that bash construct's LOCALE-COLLATION AWARENESS — under a UTF-8 locale, `[A-Za-z0-9._-]` silently widens to accept accented Latin letters, so an entry such as `"récord/**"` was accepted by the shell layer (while the one JS predicate correctly rejected the identical string) and then matched nothing under the real ASCII directory it was meant to protect. An exclude-only, re-scoped, locale-widened, or otherwise not-plainly-a-glob pathspec has no positive pathspec to pair with (or targets characters that do not exist in the real tree) and matches nothing, which is indistinguishable in shape from a legitimate non-match. The check SHALL refuse rather than treating "matched nothing" as "nothing is protected" for any shape the one predicate does not recognize, and the script-level layer SHALL hold independently of whether config-time validation ever ran (config validation alone fails open for a `concertino.config.json` edited without re-running `concertino validate`) — independence of LAYERS, not independence of PREDICATES: the script consumes the one predicate's verdict rather than deciding on its own. Any bash-side check that remains (for example, detecting an unclosed `[`, a property of git's own pathspec parser rather than of what a plain glob is) SHALL be pinned to the `C` locale, since it cannot be delegated to the one predicate and must not repeat the same locale-collation defect.

#### Scenario: An unclosed character class is not a silent pass
- **WHEN** a configured glob contains an unclosed `[` and the diff touches paths the operator intended that glob to protect
- **THEN** the check does not print `PASS` on the basis of that pattern matching nothing; the unusable pattern is surfaced

#### Scenario: A leading "!" (exclude pathspec magic) is not a silent pass
- **WHEN** a configured pattern begins with `!` (git's exclude short-form) and the diff genuinely touches a path that pattern's positive form would protect
- **THEN** the check does not print `PASS` on the basis of that pattern matching nothing; the pattern is surfaced as malformed, even if this entry reached the script without passing through config validation

#### Scenario: A leading ":" in any form (explicit pathspec magic) is not a silent pass
- **WHEN** a configured pattern begins with `:` in any form (for example `:(exclude)record/**`) and the diff genuinely touches a path that pattern's positive form would protect
- **THEN** the check does not print `PASS` on the basis of that pattern matching nothing; the pattern is surfaced as malformed

#### Scenario: A leading-space entry is not a silent pass, even though it begins with neither "!" nor ":"
- **WHEN** a configured pattern begins with a space followed by `!` or `:` (for example `" !record/**"`) and the diff genuinely touches a path that pattern's positive form would protect
- **THEN** the check does not print `PASS` on the basis of that pattern matching nothing; the pattern is surfaced as malformed, because the accept pattern rejects any entry differing from its own trimmed form rather than checking only for specific leading characters

#### Scenario: A pattern containing ".." is not a silent pass
- **WHEN** a configured pattern contains `..` anywhere and the diff genuinely touches a path that pattern's non-escaping form would protect
- **THEN** the check does not print `PASS` on the basis of that pattern matching nothing; the pattern is surfaced as malformed

#### Scenario: A diacritic entry is not a silent pass, even under a UTF-8 locale
- **WHEN** a configured pattern contains an accented Latin letter (for example `"récord/**"` intended to protect the ASCII `record/**` directory) and the diff genuinely touches a path the ASCII form would protect, and the check runs under an ambient UTF-8 locale (for example `LANG=en_US.UTF-8`)
- **THEN** the check does not print `PASS` on the basis of that pattern matching nothing under the real ASCII directory; the pattern is surfaced as malformed, because plain-glob recognition is decided by the one ASCII-only predicate rather than by a locale-collation-aware shell character-class test that could silently treat the accented letter as equivalent to its base letter

#### Scenario: A pattern matching nothing legitimately is distinguished from one that cannot match
- **WHEN** a well-formed, plain glob simply matches none of the diff's paths
- **THEN** that is a normal no-match and does not produce an unusable-pattern report

### Requirement: The glob list is read from the main checkout, never supplied by the auditor
The configured glob list SHALL be read from the project configuration in the main checkout, resolved from the worktree via git's shared-directory resolution, mirroring how the readiness check already locates the run's event log. The list SHALL NOT be accepted as a caller-supplied argument, and SHALL NOT be read from a worktree-local configuration or environment file.

#### Scenario: The check works when invoked from a worktree with no local config
- **WHEN** the check runs inside a delivery worktree that contains the rendered scripts but no project config file and no rendered environment file
- **THEN** it still reads the configured globs, by resolving the main checkout from the worktree

#### Scenario: The auditor cannot widen or empty the list
- **WHEN** the auditor invokes the check
- **THEN** there is no argument or environment variable by which it can pass an empty or narrowed glob list, so the protection cannot be satisfied by assertion

#### Scenario: An unreadable configuration fails closed
- **WHEN** the main checkout cannot be resolved, or its configuration cannot be read or parsed
- **THEN** the check refuses rather than proceeding as though no paths were protected

#### Scenario: A consuming repo's config with an empty/absent protectedPaths list is still a no-op, even though the one predicate lives only in concertino's own checkout
- **WHEN** the check runs as a copy deployed into a repository that has a real `concertino.config.json` (the ordinary case) but does not set `protectedPaths`, and that repository's own tree has no copy of concertino's `lib/config.js` at all (concertino ships `scripts/concertino/*.sh` and role/law templates into a consuming repo, never its own `lib/`)
- **THEN** the check does not attempt to resolve the one plain-glob predicate at all, and behaves exactly as the "empty protectedPaths list is a no-op" scenario above — it never refuses merely because the predicate's implementation is unreachable from that repo's tree

#### Scenario: A consuming repo with protectedPaths genuinely configured still fails closed when the one predicate is unreachable
- **WHEN** the check runs as a copy deployed into a repository whose own tree has no copy of concertino's `lib/config.js`, and that repository's `concertino.config.json` DOES set a non-empty `protectedPaths`
- **THEN** the check refuses (it does not print `PASS`) rather than silently treating "the predicate could not be resolved" as "nothing is protected", since there genuinely is something configured that cannot be validated
