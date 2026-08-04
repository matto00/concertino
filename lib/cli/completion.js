'use strict';

const { red } = require('./shared');

function cmdCompletion(args) {
  const shell = args._[1] || 'fish';
  const CMDS = ['init', 'sync', 'update', 'validate', 'diff', 'doctor', 'upgrade', 'gates', 'watch', 'completion', 'help'];
  const DESC = { init:'Interactive setup', sync:'Render harness files', update:'Update config fields and re-sync', validate:'Check config for errors', diff:'Show sync diff vs disk', doctor:'Check environment health', upgrade:'Detect stale generated files', gates:'List or run a gate', watch:'Live fleet dashboard', completion:'Print shell completion script', help:'Show help' };

  if (shell === 'fish') {
    const lines = [
      '# concertino fish completion — save to ~/.config/fish/completions/concertino.fish',
      '# Or add to config.fish: concertino completion fish | source',
      'set -l cmds ' + CMDS.join(' '),
      'complete -c concertino -f',
      ...CMDS.map((c) => `complete -c concertino -n "not __fish_seen_subcommand_from $cmds" -a ${c} -d "${DESC[c]}"`),
      'complete -c concertino -l out    -r -d "Project root directory"',
      'complete -c concertino -l config -r -d "Path to concertino.config.json"',
      'complete -c concertino -n "__fish_seen_subcommand_from sync update" -l dry-run -d "Preview without writing"',
      'complete -c concertino -n "__fish_seen_subcommand_from sync diff"   -l harness -r -d "claude-code,codex,opencode"',
      'complete -c concertino -n "__fish_seen_subcommand_from init" -l example -r -d "helio, generic, or opencode-ollama"',
      'complete -c concertino -n "__fish_seen_subcommand_from init" -l yes -d "Non-interactive defaults"',
      'complete -c concertino -n "__fish_seen_subcommand_from gates" -l run -r -d "Gate name"',
      'complete -c concertino -n "__fish_seen_subcommand_from completion" -a "fish zsh bash" -d "Shell"',
    ];
    process.stdout.write(lines.join('\n') + '\n');

  } else if (shell === 'zsh') {
    const args_map = {
      'sync|update': '"--dry-run[preview without writing]" "--out=[project root]:dir:_files -/" "--config=[config path]:file:_files" "--harness=[harnesses]:harness:(claude-code codex opencode)"',
      'diff':        '"--out=[project root]:dir:_files -/" "--config=[config path]:file:_files" "--harness=[harnesses]:harness:(claude-code codex opencode)"',
      'validate|doctor|upgrade': '"--out=[project root]:dir:_files -/" "--config=[config path]:file:_files"',
      'init':        '"--out=[project root]:dir:_files -/" "--example=[profile]:ex:(helio generic opencode-ollama)" "--yes[use defaults]"',
      'gates':       '"--run=[gate name]:gate:" "--out=[project root]:dir:_files -/" "--config=[config path]:file:_files"',
      'completion':  '":shell:(fish zsh bash)"',
    };
    const lines = [
      '#compdef concertino',
      '# concertino zsh completion — save to a $fpath dir, e.g. ~/.zsh/completions/_concertino',
      '_concertino() {',
      '  local -a cmds',
      '  cmds=(' + CMDS.map((c) => c + ':"' + DESC[c] + '"').join(' ') + ')',
      '  if (( CURRENT == 2 )); then _describe "commands" cmds',
      '  else case $words[2] in',
      ...Object.entries(args_map).map(([pat, flags]) => `    ${pat}) _arguments ${flags} ;;`),
      '  esac; fi',
      '}',
      '_concertino "$@"',
    ];
    process.stdout.write(lines.join('\n') + '\n');

  } else if (shell === 'bash') {
    const lines = [
      '# concertino bash completion — add to ~/.bashrc: source <(concertino completion bash)',
      '_concertino_complete() {',
      '  local cur="${COMP_WORDS[COMP_CWORD]}" prev="${COMP_WORDS[COMP_CWORD-1]}"',
      '  if [[ $COMP_CWORD -eq 1 ]]; then',
      '    COMPREPLY=($(compgen -W "' + CMDS.join(' ') + '" -- "$cur"))',
      '  else case "$prev" in',
      '    --out|--config) COMPREPLY=($(compgen -d -- "$cur")) ;;',
      '    --harness)  COMPREPLY=($(compgen -W "claude-code codex opencode" -- "$cur")) ;;',
      '    --example)  COMPREPLY=($(compgen -W "helio generic opencode-ollama" -- "$cur")) ;;',
      '    --run)      COMPREPLY=() ;;',
      '    completion) COMPREPLY=($(compgen -W "fish zsh bash" -- "$cur")) ;;',
      '    *)          COMPREPLY=($(compgen -W "--out --config --dry-run --harness --run --yes --example" -- "$cur")) ;;',
      '  esac; fi',
      '}',
      'complete -F _concertino_complete concertino',
    ];
    process.stdout.write(lines.join('\n') + '\n');

  } else {
    console.error(red('error: ') + 'unknown shell "' + shell + '" — supported: fish zsh bash');
    process.exit(1);
  }
}

module.exports = { cmdCompletion };
