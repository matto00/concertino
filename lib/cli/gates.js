'use strict';

const { execSync } = require('child_process');

const { bold, green, yellow, cyan, dim, red, read, exists, resolveOut, resolveConfigPath } = require('./shared');

function cmdGates(args) {
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  if (!exists(cfgPath)) { console.error(red('error: ') + 'no config at ' + cfgPath); process.exit(1); }
  const cfg = JSON.parse(read(cfgPath));
  const gates = cfg.gates || [];
  const runName = args.run;

  if (runName) {
    const gate = gates.find((g) => g.name === runName);
    if (!gate) {
      console.error(red('error: ') + 'no gate named "' + runName + '".');
      console.error('  known: ' + (gates.length ? gates.map((g) => g.name).join(', ') : '(none)'));
      process.exit(1);
    }
    console.log('concertino gates --run ' + bold(gate.name));
    console.log(dim('  when:    ') + gate.when);
    console.log(dim('  command: ') + gate.command + '\n');
    try {
      execSync(gate.command, { stdio: 'inherit', cwd: out });
      console.log('\n  ' + green('✓ ' + gate.name + ' passed'));
    } catch (e) {
      console.log('\n  ' + red('✗ ' + gate.name + ' failed') + dim(' (exit ' + (e.status || 1) + ')'));
      process.exit(e.status || 1);
    }
    return;
  }

  console.log('concertino gates');
  if (!gates.length) { console.log('\n  ' + dim('no gates configured')); return; }
  console.log('');
  for (const g of gates) {
    const placeholder = /^echo "TODO/.test(g.command);
    console.log('  ' + (placeholder ? yellow('!') : cyan('▸')) + ' ' + bold(g.name) + '  ' + dim('when: ' + g.when));
    console.log('      ' + dim(g.command) + (placeholder ? '  ' + yellow('← placeholder') : ''));
  }
  console.log('\n  ' + dim('concertino gates --run <name>'));
}

module.exports = { cmdGates };
