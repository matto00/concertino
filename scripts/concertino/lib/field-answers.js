// field-answers.js — shared multi-line field-answer extraction (CON-169).
//
// Not a standalone script: it is a lib `require()`d by `node -e` programs
// embedded in assert-phase.sh's `setup` and `delivery` cases (two separate
// node processes, no shared JS scope — see design.md Decision 2).
//
// Reads a field's answer as the text between the end of its
// `**<field>:**`-shaped marker and the earliest subsequent occurrence of any
// OTHER marker in the same `fields` list, or the end of the section if none
// follows. Positions are derived from the actual text, never from the
// declared order of `fields`, so out-of-order documents still parse
// correctly. A bold span inside an answer's prose cannot truncate the
// answer, because only the enumerated markers are searched for — never a
// generic bold-span pattern.
//
// `section.indexOf(marker)` binds to the FIRST occurrence of a given marker
// only — a document that repeats a field marker (e.g. the same `**Verdict:**`
// text twice) silently ignores the second one. Not reachable from the
// current templates, but worth recording (final-gate skeptic, CON-169).
//
// extractFieldAnswers(section, fields) -> Map<field, trimmedAnswerString>
//   section: the text to search (already bounded to its section/heading).
//   fields:  array of field labels; each is matched as `**<field>**`
//            (verbatim, including any trailing colon the caller includes).
function extractFieldAnswers(section, fields) {
  // Locate every marker's start/end position up front so extents can be
  // computed from real positions rather than declared order.
  const positions = [];
  for (const f of fields) {
    const marker = `**${f}**`;
    const at = section.indexOf(marker);
    if (at === -1) continue;
    positions.push({ field: f, at, end: at + marker.length });
  }

  const answers = new Map();
  for (const f of fields) {
    const found = positions.find((p) => p.field === f);
    if (!found) continue;
    // Earliest OTHER marker occurring after this one's end bounds the
    // extent; absent any, the extent runs to the section end.
    let extentEnd = section.length;
    for (const other of positions) {
      if (other.field === f) continue;
      if (other.at >= found.end && other.at < extentEnd) extentEnd = other.at;
    }
    const answer = section.slice(found.end, extentEnd).trim();
    answers.set(f, answer);
  }
  return answers;
}

// A field written as its own markdown bullet immediately followed by another
// bulleted field (e.g. "- **Claims checked:**\n- **Already-done scope:**
// ...") sweeps the next bullet's leading list-marker character into the
// EMPTY field's extent, trimming to "-" rather than "". Left undetected,
// this silently loosens both gates for exactly the bulleted-checklist style
// the templates and this test suite's own fixtures use (final-gate skeptic,
// CON-169 REFUTE). Any extracted span that is nothing but markdown list
// markers (-, *, +) and/or whitespace is therefore ALSO treated as missing,
// alongside the literal `placeholders` set.
const LIST_RESIDUE_ONLY = /^[-*+\s]*$/;

// missingFields(section, fields, placeholders) -> string[]
//   Field is "missing" when its marker is absent entirely, its extracted
//   answer (lower-cased) is in `placeholders`, or its extracted answer is
//   nothing but markdown list-marker/whitespace residue (see
//   LIST_RESIDUE_ONLY above). Order matches `fields`.
function missingFields(section, fields, placeholders) {
  const answers = extractFieldAnswers(section, fields);
  const missing = [];
  for (const f of fields) {
    const answer = answers.get(f);
    if (answer === undefined) {
      missing.push(f);
      continue;
    }
    if (placeholders.has(answer.toLowerCase()) || LIST_RESIDUE_ONLY.test(answer)) {
      missing.push(f);
    }
  }
  return missing;
}

module.exports = { extractFieldAnswers, missingFields };
