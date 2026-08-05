'use strict';

// The shared section-header widget (design.md Decision 4). Composes an icon
// (always a `lib/ui/icons.js` export) with a label the same "icon + ' ' +
// label" way `dashboard-iconography`'s existing requirement already mandates
// — the one place every icon+label composition is built, rather than each
// screen inlining `icon + ' ' + label` independently. Introduces no new
// glyph itself: `icon` is always something already exported by
// `lib/ui/icons.js`, or omitted.

// sectionHeader({ icon, label, colour }) -> string. `icon + ' ' + label` when
// `icon` is given; `label` alone when omitted (spec.md's "Omitting the icon
// returns the label unchanged" scenario — with no `colour` passed either,
// this returns exactly `label`). Either way, the composed text is wrapped in
// `colour` when one is supplied.
function sectionHeader({ icon, label, colour }) {
  const composed = icon ? icon + ' ' + label : label;
  return colour ? colour(composed) : composed;
}

module.exports = { sectionHeader };
