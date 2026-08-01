# CON-42: Iconography for sections, labels, and metadata across the dashboard

## Description

Add icons/glyphs to section headers and labels throughout the dashboard — named example: the branch name row on the drill-down screen (`lib/ui/screens/drilldown.js:333`, `splitLine(run.branch || f.dim('(no branch yet)'), harnessText(run), cols)`), which today is plain text with no visual marker for "this is a branch."

## Scope history

Originally requested alongside CON-30 (visual design pass 2) and flagged as a possible interrupt to that in-flight work. Briefly folded into CON-30's scope on 2026-07-30, mid-run — but that fold was never actually threaded into CON-30's design/tasks artifacts, and CON-30's design-gate rounds and execution proceeded on colour/hierarchy/density only. Caught and reverted 2026-07-30, after CON-30 had already shipped that narrower scope. This ticket is reopened as its own independent piece of work — not absorbed into CON-30.

If it lands as its own change: coordinate with whatever CON-30 shipped for colour/hierarchy so icon choice and colour don't fight each other (e.g. an icon that duplicates what STATUS_COLOUR already signals adds noise, not information).

## Constraints

* Must degrade honestly on a terminal/font without the glyphs available — this project's existing discipline (`layout.js`'s structural border-character focus distinction, kept independent of colour so it survives a no-colour terminal) is the precedent: icons should be additive polish, never load-bearing for understanding a screen's state.
* Should not widen rows in a way that breaks the existing width-budget accounting (`format.js`'s `visibleLength`/`truncate`/`padTo`, which already has to treat multi-byte/wide characters carefully per CON-16's sibling concern) — an emoji or wide glyph counts as more than one visible column and must be measured, not assumed to be one character.
