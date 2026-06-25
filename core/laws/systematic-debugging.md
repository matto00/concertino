---
name: systematic-debugging
description: Iron Law for debugging — no fix without a probe-confirmed root cause.
applies_to: executor
inspired_by: superpowers/systematic-debugging (https://github.com/obra/superpowers)
note: Inspired by superpowers; rewritten for Concertino. No runtime dependency.
---

# Systematic Debugging

## The Iron Law

**NO FIX WITHOUT A PROBE-CONFIRMED ROOT CAUSE.**

You may not edit code to fix a failure until you have a hypothesis for the root
cause **and a minimal probe whose output confirms that hypothesis predicts the
symptom.** A guess is not a root cause. A symptom patch is a failure, not a fix.

## Phases (complete in order)

1. **Investigate.** Read the actual error message, stack trace, and failing
   output in full. Reproduce the failure consistently — record the exact
   command/steps. Identify recent changes that could have caused it.
2. **Locate the layer.** Most systems are multi-layer (UI → state → service →
   API/route → data access → store, or the equivalent for your stack). Trace the
   data flow from symptom back toward origin and establish **which layer**
   actually fails. Don't fix the layer where the symptom _appears_ if the cause is
   upstream. (Your project's layer chain is described in its canonical code-quality
   doc / architecture notes — read it if you're unsure of the boundaries.)
3. **Compare to a working example.** Find a sibling that works (another route,
   module, component, query) and diff the behavior. The difference is usually the
   lead.
4. **Hypothesize + probe.** State the suspected root cause in one sentence. Then
   run a **minimal probe** — a log line, a focused test, a request, a REPL query —
   whose output _confirms_ the hypothesis. If the probe doesn't confirm it, the
   hypothesis is wrong; form a new one. Do not proceed on an unconfirmed cause.
5. **Fix the root cause + lock it.** Fix the confirmed cause (not the symptom).
   Add a regression test that fails before the fix and passes after
   (see [[verification-before-completion]]). Then verify the original symptom is
   gone with fresh evidence.

## Required evidence (record in your handoff)

For every bug you fix, your handoff (e.g. `files-modified.md`) or return summary
must include:

- **Root cause:** one sentence, naming the failing layer.
- **Probe:** the exact command/snippet you ran to confirm it.
- **Probe output:** the output that confirms the cause predicts the symptom.

The evaluator/skeptic checks that this artifact exists and is real. An
unconfirmed "root cause" is treated as not-yet-investigated.

## Red-flag phrases — STOP and return to Phase 1

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "I don't fully understand it but this might work"
- Reaching for a second fix when the first didn't work and you still can't name the cause

## Circuit breaker (bounded — required for autonomous operation)

After **N failed fix attempts on the same symptom** (N = `budgets.debugAttempts`,
default 2), stop patching. Either the root cause is wrong or the architecture is
fighting you. Re-run Phase 1 from scratch **once**; if the next attempt would be a
guess, **escalate** — surface the symptom, the hypotheses tried, and the probe
outputs, and ask for direction. Never thrash silently, never give up silently.
