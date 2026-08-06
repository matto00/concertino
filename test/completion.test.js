'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// CON-86 shell-completion-flag-tables: `lib/cli/completion.js`'s per-command
// flag/value tables never mentioned `watch`/`prune`/`eject`/`migrate`/
// `answer`. Exercises `bin/concertino completion <shell>` as a real
// subprocess (mirrors test/answer.test.js's rationale — cmdCompletion is
// simple enough not to need in-process mocking of process.stdout.write).

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');

function runCompletion(shell) {
  return execFileSync('node', [BIN, 'completion', shell], { encoding: 'utf8' });
}

// --- fish ---------------------------------------------------------------

test('fish completion: prune offers --dry-run', () => {
  const out = runCompletion('fish');
  assert.match(out, /__fish_seen_subcommand_from prune" -l dry-run/);
});

test('fish completion: eject offers --role (five role names) and --harness', () => {
  const out = runCompletion('fish');
  assert.match(out, /__fish_seen_subcommand_from eject" -l role -r -a "orchestrator executor evaluator skeptic auditor"/);
  assert.match(out, /__fish_seen_subcommand_from eject" -l harness -r -a "claude-code codex opencode"/);
});

test('fish completion: migrate offers --dry-run', () => {
  const out = runCompletion('fish');
  assert.match(out, /__fish_seen_subcommand_from migrate" -l dry-run/);
});

test('fish completion: answer offers --sub and --total', () => {
  const out = runCompletion('fish');
  assert.match(out, /__fish_seen_subcommand_from answer" -l sub/);
  assert.match(out, /__fish_seen_subcommand_from answer" -l total/);
});

test('fish completion: watch needs no new -n scoped block (already global)', () => {
  const out = runCompletion('fish');
  assert.doesNotMatch(out, /__fish_seen_subcommand_from watch/);
  // --out/--config remain the pre-existing subcommand-independent lines
  assert.match(out, /complete -c concertino -l out {4}-r -d "Project root directory"/);
  assert.match(out, /complete -c concertino -l config -r -d "Path to concertino\.config\.json"/);
});

test('fish completion: pre-existing sync/diff/init/gates/completion entries unchanged', () => {
  const out = runCompletion('fish');
  assert.match(out, /__fish_seen_subcommand_from sync update" -l dry-run/);
  assert.match(out, /__fish_seen_subcommand_from sync diff" {3}-l harness -r -d "claude-code,codex,opencode"/);
  assert.match(out, /__fish_seen_subcommand_from init" -l example -r -d "helio, generic, or opencode-ollama"/);
  assert.match(out, /__fish_seen_subcommand_from init" -l yes -d "Non-interactive defaults"/);
  assert.match(out, /__fish_seen_subcommand_from gates" -l run -r -d "Gate name"/);
  assert.match(out, /__fish_seen_subcommand_from completion" -a "fish zsh bash" -d "Shell"/);
});

// --- zsh ------------------------------------------------------------------

test('zsh completion: prune offers --dry-run', () => {
  const out = runCompletion('zsh');
  assert.match(out, /prune\) _arguments "--dry-run\[preview without writing\]" ;;/);
});

test('zsh completion: eject offers --role (five role names) and --harness', () => {
  const out = runCompletion('zsh');
  assert.match(out, /eject\) _arguments "--role=\[agent role\]:role:\(orchestrator executor evaluator skeptic auditor\)" "--harness=\[target harness\]:harness:\(claude-code codex opencode\)" ;;/);
});

test('zsh completion: migrate offers --dry-run', () => {
  const out = runCompletion('zsh');
  assert.match(out, /migrate\) _arguments "--dry-run\[preview without writing\]" ;;/);
});

test('zsh completion: answer offers --sub and --total', () => {
  const out = runCompletion('zsh');
  assert.match(out, /answer\) _arguments "--sub=\[sub-answer index\]:index:" "--total=\[sub-answer total\]:total:" ;;/);
});

test('zsh completion: watch gets a dedicated args_map entry (zsh has no global mechanism)', () => {
  const out = runCompletion('zsh');
  assert.match(out, /watch\) _arguments "--out=\[project root\]:dir:_files -\/" "--config=\[config path\]:file:_files" ;;/);
});

test('zsh completion: pre-existing sync/diff/init/gates/completion entries unchanged', () => {
  const out = runCompletion('zsh');
  assert.match(out, /sync\|update\) _arguments "--dry-run\[preview without writing\]" "--out=\[project root\]:dir:_files -\/" "--config=\[config path\]:file:_files" "--harness=\[harnesses\]:harness:\(claude-code codex opencode\)" ;;/);
  assert.match(out, /diff\) _arguments "--out=\[project root\]:dir:_files -\/" "--config=\[config path\]:file:_files" "--harness=\[harnesses\]:harness:\(claude-code codex opencode\)" ;;/);
  assert.match(out, /validate\|doctor\|upgrade\) _arguments "--out=\[project root\]:dir:_files -\/" "--config=\[config path\]:file:_files" ;;/);
  assert.match(out, /init\) _arguments "--out=\[project root\]:dir:_files -\/" "--example=\[profile\]:ex:\(helio generic opencode-ollama\)" "--yes\[use defaults\]" ;;/);
  assert.match(out, /gates\) _arguments "--run=\[gate name\]:gate:" "--out=\[project root\]:dir:_files -\/" "--config=\[config path\]:file:_files" ;;/);
  assert.match(out, /completion\) _arguments ":shell:\(fish zsh bash\)" ;;/);
});

// --- bash -------------------------------------------------------------

test('bash completion: --role and --sub/--total are in the flag-name catch-all', () => {
  const out = runCompletion('bash');
  assert.match(out, /compgen -W "--out --config --dry-run --harness --run --yes --example --role --sub --total"/);
});

test('bash completion: --role completes the five role names', () => {
  const out = runCompletion('bash');
  assert.match(out, /--role\) {5}COMPREPLY=\(\$\(compgen -W "orchestrator executor evaluator skeptic auditor" -- "\$cur"\)\) ;;/);
});

test('bash completion: --sub/--total take no suggested value', () => {
  const out = runCompletion('bash');
  assert.match(out, /--sub\|--total\) COMPREPLY=\(\) ;;/);
});

test('bash completion: --dry-run already generic for prune/migrate (no change needed)', () => {
  const out = runCompletion('bash');
  assert.match(out, /--dry-run/);
});

test('bash completion: pre-existing --harness/--example/--run/completion entries unchanged', () => {
  const out = runCompletion('bash');
  assert.match(out, /--harness\) {2}COMPREPLY=\(\$\(compgen -W "claude-code codex opencode" -- "\$cur"\)\) ;;/);
  assert.match(out, /--example\) {2}COMPREPLY=\(\$\(compgen -W "helio generic opencode-ollama" -- "\$cur"\)\) ;;/);
  assert.match(out, /--run\) {6}COMPREPLY=\(\) ;;/);
  assert.match(out, /completion\) COMPREPLY=\(\$\(compgen -W "fish zsh bash" -- "\$cur"\)\) ;;/);
});
