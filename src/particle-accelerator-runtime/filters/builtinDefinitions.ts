import { DeclarativeFilterDefinition } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';

export const BUILTIN_DEFINITIONS: DeclarativeFilterDefinition[] = [

  // ─── Docker ──────────────────────────────────────────────────────────
  {
    id: 'docker-build',
    displayName: 'Docker Build',
    version: '1.0.0',
    commandPatterns: ['^docker\\s+(build|buildx\\s+build)\\b'],
    suppressPatterns: [
      '^\\s*#\\d+\\s+\\[internal\\]',
      '^\\s*#\\d+\\s+(DONE|CACHED)\\s',
      '^\\s*=>\\s+(exporting|transferring|extracting)',
      '^Sending build context',
      '^\\s*--->\\s+[a-f0-9]+',
      '^Removing intermediate container',
      'npm warn', 'npm notice',
      '^\\s*\\d+\\.\\d+\\s+MB',
      '^\\s*Step\\s+\\d+/\\d+\\s*:',
    ],
    importantPatterns: [
      'error', 'ERROR', 'FAILED', 'failed to',
      'Successfully built', 'Successfully tagged',
      'SECURITY WARNING', 'COPY', 'FROM', 'RUN',
      'exited with code [^0]',
      '#\\d+ ERROR',
    ],
  },
  {
    id: 'docker-compose',
    displayName: 'Docker Compose',
    version: '1.0.0',
    commandPatterns: ['^docker\\s+compose\\s+(up|down|build|logs|restart|stop|start)\\b'],
    suppressPatterns: [
      'Pulling\\s+\\w+',
      '^\\s*[a-f0-9]+:\\s*(Pulling|Waiting|Downloading|Extracting|Verifying)',
      '^\\s*Digest:',
      '^\\s*Status:.*pulled',
    ],
    importantPatterns: [
      'error', 'ERROR', 'exited with code',
      'Starting', 'Stopping', 'Removing',
      'Container\\s+\\S+\\s+(Started|Created|Stopped|Removed)',
      'is up-to-date', 'service .* is not running',
    ],
  },
  {
    id: 'docker-push-pull',
    displayName: 'Docker Push/Pull',
    version: '1.0.0',
    commandPatterns: ['^docker\\s+(push|pull)\\b'],
    suppressPatterns: [
      '^[a-f0-9]+:\\s*(Preparing|Waiting|Pushing|Layer already|Mounted from)',
      '^[a-f0-9]+:\\s*(Pulling|Downloading|Extracting|Verifying)',
      '^\\s*\\d+\\.\\d+[kMG]B',
    ],
    importantPatterns: [
      'error', 'ERROR', 'denied', 'unauthorized',
      'digest:', 'latest:', 'Pushed', 'Downloaded',
      'Status:', 'not found',
    ],
  },
  {
    id: 'docker-ps',
    displayName: 'Docker PS',
    version: '1.0.0',
    commandPatterns: ['^docker\\s+(ps|images|image\\s+ls|container\\s+ls)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'Exited', 'Restarting', 'Dead', 'Created',
      'error', 'ERROR',
    ],
  },
  {
    id: 'docker-logs',
    displayName: 'Docker Logs',
    version: '1.0.0',
    commandPatterns: ['^docker\\s+(logs|compose\\s+logs)\\b'],
    suppressPatterns: [
      '^\\s*$',
    ],
    importantPatterns: [
      'error', 'ERROR', 'FATAL', 'panic', 'exception',
      'traceback', 'failed', 'crash', 'killed',
      'listening on', 'started', 'ready',
    ],
  },

  // ─── Go ──────────────────────────────────────────────────────────────
  {
    id: 'go-test',
    displayName: 'Go Test',
    version: '1.0.0',
    commandPatterns: ['^go\\s+test\\b'],
    suppressPatterns: [
      '^ok\\s+',
      '^\\?\\s+.*\\[no test files\\]',
      '^\\s*$',
    ],
    importantPatterns: [
      'FAIL', 'PANIC', 'panic:', 'Error Trace:',
      '--- FAIL', '--- PASS',
      'FATAL', 'error', 'expected', 'got',
      '^\\s+\\S+\\.go:\\d+',
      '\\d+\\s+passed', '\\d+\\s+failed',
    ],
  },
  {
    id: 'go-build',
    displayName: 'Go Build',
    version: '1.0.0',
    commandPatterns: ['^go\\s+(build|install|run)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error', 'cannot find', 'undefined:', 'imported and not used',
      'declared and not used', 'syntax error',
    ],
  },
  {
    id: 'go-vet',
    displayName: 'Go Vet',
    version: '1.0.0',
    commandPatterns: ['^go\\s+vet\\b'],
    suppressPatterns: [],
    importantPatterns: [
      '\\S+\\.go:\\d+:\\d+:',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>\\S+\\.go):\\d+:\\d+:',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'go-mod',
    displayName: 'Go Mod',
    version: '1.0.0',
    commandPatterns: ['^go\\s+mod\\s+(tidy|download|vendor)\\b'],
    suppressPatterns: [
      '^go: downloading\\s+',
      '^go: finding\\s+',
    ],
    importantPatterns: [
      'error', 'go: .*require', 'added', 'removed', 'upgraded',
    ],
  },
  {
    id: 'golangci-lint',
    displayName: 'golangci-lint',
    version: '1.0.0',
    commandPatterns: ['^golangci-lint\\s+run\\b'],
    suppressPatterns: [
      '^level=info',
    ],
    importantPatterns: [
      '\\S+\\.go:\\d+:\\d+:',
      'error', 'warning',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>\\S+\\.go):\\d+:\\d+:',
    maxDiagnosticsPerFile: 10,
  },

  // ─── Rust / Cargo ───────────────────────────────────────────────────
  {
    id: 'cargo-build',
    displayName: 'Cargo Build',
    version: '1.0.0',
    commandPatterns: ['^cargo\\s+(build|check)\\b'],
    suppressPatterns: [
      '^\\s*Compiling\\s+',
      '^\\s*Downloading\\s+',
      '^\\s*Downloaded\\s+',
      '^\\s*Blocking\\s+waiting',
      '^\\s*Updating\\s+',
      '^\\s*Fresh\\s+',
    ],
    importantPatterns: [
      '^error', '^warning', 'aborting due to',
      'could not compile', 'cannot find',
      'Finished', 'Compiling.*\\(bin\\)',
    ],
  },
  {
    id: 'cargo-test',
    displayName: 'Cargo Test',
    version: '1.0.0',
    commandPatterns: ['^cargo\\s+test\\b'],
    suppressPatterns: [
      '^\\s*Compiling\\s+',
      '^\\s*Downloading\\s+',
      '^\\s*Downloaded\\s+',
      '^\\s*Fresh\\s+',
      '^\\s*Running\\s+unittests',
      'test\\s+\\S+\\s+\\.\\.\\.\\s+ok$',
    ],
    importantPatterns: [
      'FAILED', 'failures:', 'panicked at',
      'test result:', 'error\\[', 'thread .* panicked',
      'left:', 'right:',
    ],
  },
  {
    id: 'cargo-clippy',
    displayName: 'Cargo Clippy',
    version: '1.0.0',
    commandPatterns: ['^cargo\\s+clippy\\b'],
    suppressPatterns: [
      '^\\s*Checking\\s+',
      '^\\s*Compiling\\s+',
      '^\\s*Fresh\\s+',
    ],
    importantPatterns: [
      '^warning:', '^error:',
      '-->', 'help:', 'note:',
    ],
  },
  {
    id: 'cargo-fmt',
    displayName: 'Cargo Fmt',
    version: '1.0.0',
    commandPatterns: ['^cargo\\s+fmt\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'Diff in', 'error', 'warning',
    ],
  },

  // ─── Python Tools ───────────────────────────────────────────────────
  {
    id: 'pip-install',
    displayName: 'Pip Install',
    version: '1.0.0',
    commandPatterns: ['^pip3?\\s+install\\b', '^python3?\\s+-m\\s+pip\\s+install\\b'],
    suppressPatterns: [
      '^\\s*Downloading\\s+',
      '^\\s*Using cached\\s+',
      '^\\s*Collecting\\s+',
      '^\\s*Building wheels',
      '^\\s*Installing build dependencies',
      '^\\s*Getting requirements',
      '^\\s*Preparing metadata',
      '^\\s*[━░▒▓]+',
    ],
    importantPatterns: [
      'ERROR', 'Successfully installed', 'Requirement already satisfied',
      'WARNING', 'Could not find', 'No matching distribution',
    ],
  },
  {
    id: 'pip-list',
    displayName: 'Pip List',
    version: '1.0.0',
    commandPatterns: ['^pip3?\\s+(list|freeze)\\b'],
    suppressPatterns: [],
    importantPatterns: [],
  },
  {
    id: 'mypy',
    displayName: 'mypy',
    version: '1.0.0',
    commandPatterns: ['^(python3?\\s+-m\\s+)?mypy\\b'],
    suppressPatterns: [
      '^Found\\s+\\d+\\s+source',
      '^\\s*$',
    ],
    importantPatterns: [
      'error:', 'note:',
      'Found \\d+ error',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.py):\\d+:',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'ruff-check',
    displayName: 'Ruff Check',
    version: '1.0.0',
    commandPatterns: ['^(python3?\\s+-m\\s+)?ruff\\s+check\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'Found \\d+', 'error', 'fixable',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.py):\\d+:\\d+:',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'ruff-format',
    displayName: 'Ruff Format',
    version: '1.0.0',
    commandPatterns: ['^(python3?\\s+-m\\s+)?ruff\\s+format\\b'],
    suppressPatterns: [],
    importantPatterns: [
      '\\d+ file', 'would reformat', 'reformatted',
      'error', 'All checks passed',
    ],
  },
  {
    id: 'black',
    displayName: 'Black',
    version: '1.0.0',
    commandPatterns: ['^(python3?\\s+-m\\s+)?black\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'would reformat', 'reformatted', 'All done',
      '\\d+ file', 'error', 'Oh no!',
    ],
  },
  {
    id: 'flake8',
    displayName: 'Flake8',
    version: '1.0.0',
    commandPatterns: ['^(python3?\\s+-m\\s+)?flake8\\b'],
    suppressPatterns: [],
    importantPatterns: [
      '\\S+:\\d+:\\d+:',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.py):\\d+:\\d+:',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'pylint',
    displayName: 'Pylint',
    version: '1.0.0',
    commandPatterns: ['^(python3?\\s+-m\\s+)?pylint\\b'],
    suppressPatterns: [
      '^\\*+',
      '^Module\\s+',
    ],
    importantPatterns: [
      '\\S+:\\d+:\\d+:', 'Your code has been rated',
      'error', 'warning', 'convention', 'refactor',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>\\S+\\.py):\\d+:\\d+:',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'python-unittest',
    displayName: 'Python Unittest',
    version: '1.0.0',
    commandPatterns: ['^python3?\\s+-m\\s+unittest\\b'],
    suppressPatterns: [
      '^\\.\\.+$',
    ],
    importantPatterns: [
      'FAIL', 'ERROR', 'Traceback', 'AssertionError',
      'Ran \\d+ test', 'OK', 'FAILED',
    ],
  },
  {
    id: 'uv-sync',
    displayName: 'UV Sync',
    version: '1.0.0',
    commandPatterns: ['^uv\\s+(sync|pip\\s+install|pip\\s+compile)\\b'],
    suppressPatterns: [
      '^\\s*Resolved\\s+',
      '^\\s*Downloading\\s+',
      '^\\s*Building\\s+',
      '^\\s*Prepared\\s+',
    ],
    importantPatterns: [
      'error', 'Installed', 'Uninstalled', 'Audited',
    ],
  },

  // ─── .NET ───────────────────────────────────────────────────────────
  {
    id: 'dotnet-build',
    displayName: 'Dotnet Build',
    version: '1.0.0',
    commandPatterns: ['^dotnet\\s+(build|publish|restore)\\b'],
    suppressPatterns: [
      '^\\s*Determining projects to restore',
      '^\\s*Restored\\s+',
      '^\\s*\\d+ Warning\\(s\\)$',
      '^\\s*\\d+ Error\\(s\\)$',
      '^\\s*Time Elapsed',
    ],
    importantPatterns: [
      'error\\s+\\w+\\d+:', 'warning\\s+\\w+\\d+:',
      'Build succeeded', 'Build FAILED',
      'Error\\(s\\)', '-> ',
    ],
  },
  {
    id: 'dotnet-test',
    displayName: 'Dotnet Test',
    version: '1.0.0',
    commandPatterns: ['^dotnet\\s+test\\b'],
    suppressPatterns: [
      '^\\s*Determining projects to restore',
      '^\\s*Restored\\s+',
      '^\\s*Starting test execution',
    ],
    importantPatterns: [
      'Failed!', 'Passed!', 'Total tests:',
      'Failed\\s+\\d+', 'Passed\\s+\\d+',
      'error', 'Assert\\.',
    ],
  },

  // ─── Kubernetes ─────────────────────────────────────────────────────
  {
    id: 'kubectl-get',
    displayName: 'Kubectl Get',
    version: '1.0.0',
    commandPatterns: ['^kubectl\\s+(get|describe|top)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'CrashLoopBackOff', 'Error', 'ImagePullBackOff', 'OOMKilled',
      'Pending', 'Terminating', 'Failed', 'Warning',
      'Events:', 'Conditions:',
    ],
  },
  {
    id: 'kubectl-apply',
    displayName: 'Kubectl Apply',
    version: '1.0.0',
    commandPatterns: ['^kubectl\\s+(apply|create|delete|patch|replace)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'created', 'configured', 'deleted', 'unchanged',
      'error', 'invalid', 'not found', 'forbidden',
    ],
  },
  {
    id: 'kubectl-logs',
    displayName: 'Kubectl Logs',
    version: '1.0.0',
    commandPatterns: ['^kubectl\\s+logs\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error', 'ERROR', 'FATAL', 'panic', 'exception',
      'traceback', 'failed', 'crash',
    ],
  },
  {
    id: 'helm',
    displayName: 'Helm',
    version: '1.0.0',
    commandPatterns: ['^helm\\s+(install|upgrade|list|status|template|rollback|uninstall)\\b'],
    suppressPatterns: [
      '^\\s*$',
    ],
    importantPatterns: [
      'STATUS:', 'REVISION:', 'NOTES:',
      'Error:', 'failed', 'deployed', 'superseded',
    ],
  },

  // ─── Cloud / Infrastructure ─────────────────────────────────────────
  {
    id: 'terraform-plan',
    displayName: 'Terraform Plan',
    version: '1.0.0',
    commandPatterns: ['^terraform\\s+(plan|apply|destroy)\\b', '^tofu\\s+(plan|apply|destroy)\\b'],
    suppressPatterns: [
      '^\\s*Refreshing state',
      '^\\s*Reading\\.\\.\\.',
      '^\\s*Preparing\\.\\.\\.',
    ],
    importantPatterns: [
      'Plan:', 'Apply complete!', 'Error:', 'Warning:',
      'will be created', 'will be destroyed', 'must be replaced',
      'will be updated', 'No changes',
      '\\d+ to add, \\d+ to change, \\d+ to destroy',
    ],
  },
  {
    id: 'terraform-init',
    displayName: 'Terraform Init',
    version: '1.0.0',
    commandPatterns: ['^terraform\\s+init\\b', '^tofu\\s+init\\b'],
    suppressPatterns: [
      '^\\s*-\\s+Installing\\s+',
      '^\\s*-\\s+Installed\\s+',
      '^Initializing provider plugins',
      '^Initializing modules',
    ],
    importantPatterns: [
      'successfully initialized', 'Error:', 'Warning:',
      'Terraform has been successfully initialized',
    ],
  },
  {
    id: 'terraform-validate',
    displayName: 'Terraform Validate',
    version: '1.0.0',
    commandPatterns: ['^terraform\\s+(validate|fmt)\\b', '^tofu\\s+(validate|fmt)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'Success!', 'Error:', 'Warning:',
      'valid', 'invalid',
    ],
  },
  {
    id: 'aws-cli',
    displayName: 'AWS CLI',
    version: '1.0.0',
    commandPatterns: ['^aws\\s+'],
    suppressPatterns: [
      '^\\s*$',
    ],
    importantPatterns: [
      'error', 'Error', 'An error occurred',
      'AccessDenied', 'Not Found', 'InvalidParameter',
    ],
  },
  {
    id: 'gcloud',
    displayName: 'Google Cloud CLI',
    version: '1.0.0',
    commandPatterns: ['^gcloud\\s+'],
    suppressPatterns: [
      '^\\s*$',
    ],
    importantPatterns: [
      'ERROR', 'WARNING', 'Created', 'Updated', 'Deleted',
      'done', 'status',
    ],
  },
  {
    id: 'ansible-playbook',
    displayName: 'Ansible Playbook',
    version: '1.0.0',
    commandPatterns: ['^ansible-playbook\\b', '^ansible\\s+'],
    suppressPatterns: [
      '^\\s*ok:\\s+\\[',
      '^\\s*skipping:\\s+\\[',
      '^\\s*included:',
    ],
    importantPatterns: [
      'fatal:', 'failed:', 'FAILED', 'unreachable',
      'changed:', 'PLAY RECAP', 'PLAY \\[',
      'TASK \\[',
    ],
  },

  // ─── Java / JVM ────────────────────────────────────────────────────
  {
    id: 'maven',
    displayName: 'Maven',
    version: '1.0.0',
    commandPatterns: ['^(mvn|\\.[\\\\/]mvnw)\\b'],
    suppressPatterns: [
      '^\\[INFO\\]\\s+---\\s+',
      '^Downloading from\\s+',
      '^Downloaded from\\s+',
      '^Progress\\s+',
      '^\\[INFO\\]\\s*$',
    ],
    importantPatterns: [
      '\\[ERROR\\]', 'BUILD FAILURE', 'BUILD SUCCESS',
      'Tests run:', 'Failures:', 'Errors:',
      'There are test failures', 'Compilation failure',
    ],
  },
  {
    id: 'gradle',
    displayName: 'Gradle',
    version: '1.0.0',
    commandPatterns: ['^(gradle|\\.[\\\\/]gradlew)\\b'],
    suppressPatterns: [
      '^Downloading\\s+',
      '^\\s*>\\s+Task\\s+:.*UP-TO-DATE',
      '^\\s*>\\s+Task\\s+:.*NO-SOURCE',
      '^\\s*>\\s+Task\\s+:.*FROM-CACHE',
    ],
    importantPatterns: [
      'FAILED', 'BUILD SUCCESSFUL', 'BUILD FAILED',
      '\\d+ test.*failed', 'Execution failed for task',
      'error:', 'warning:',
    ],
  },

  // ─── C / C++ ────────────────────────────────────────────────────────
  {
    id: 'make',
    displayName: 'Make',
    version: '1.0.0',
    commandPatterns: ['^make\\b'],
    suppressPatterns: [
      "^make\\[\\d+\\]:\\s+(Entering|Leaving) directory",
      '^\\s*cc\\s+',
      '^\\s*g\\+\\+\\s+-c\\s+',
    ],
    importantPatterns: [
      'error:', 'Error \\d+', 'Stop\\.',
      'warning:', 'undefined reference',
      'make.*Error', 'ld returned',
    ],
  },
  {
    id: 'cmake',
    displayName: 'CMake',
    version: '1.0.0',
    commandPatterns: ['^cmake\\b'],
    suppressPatterns: [
      '^--\\s+Check',
      '^--\\s+Looking for',
      '^--\\s+Detecting',
      '^--\\s+Found\\s+',
    ],
    importantPatterns: [
      'CMake Error', 'CMake Warning', 'error:',
      'Configuring done', 'Generating done', 'Build files',
    ],
  },
  {
    id: 'gcc-clang',
    displayName: 'GCC/Clang',
    version: '1.0.0',
    commandPatterns: ['^(gcc|g\\+\\+|clang|clang\\+\\+)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error:', 'warning:', 'note:',
      'undefined reference', 'ld returned',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.[chCH](?:pp|xx)?):',
    maxDiagnosticsPerFile: 10,
  },

  // ─── Linters / Formatters ──────────────────────────────────────────
  {
    id: 'prettier',
    displayName: 'Prettier',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?prettier\\b'],
    suppressPatterns: [],
    importantPatterns: [
      '\\d+ file', 'All matched files', 'error',
      'would reformat', 'unchanged',
    ],
  },
  {
    id: 'biome',
    displayName: 'Biome',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?biome\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error', 'warning', 'Fixed',
      '\\d+ diagnostics?',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.[jt]sx?):\\d+:\\d+',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'markdownlint',
    displayName: 'Markdownlint',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?markdownlint\\b'],
    suppressPatterns: [],
    importantPatterns: [],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.md):\\d+',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'yamllint',
    displayName: 'Yamllint',
    version: '1.0.0',
    commandPatterns: ['^yamllint\\b'],
    suppressPatterns: [],
    importantPatterns: [],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.ya?ml)$',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'shellcheck',
    displayName: 'ShellCheck',
    version: '1.0.0',
    commandPatterns: ['^shellcheck\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error', 'warning', 'note',
    ],
    groupByFile: true,
    diagnosticPattern: '^In (?<file>\\S+) line \\d+',
    maxDiagnosticsPerFile: 10,
  },
  {
    id: 'basedpyright',
    displayName: 'Basedpyright',
    version: '1.0.0',
    commandPatterns: ['^(basedpyright|pyright)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error:', '\\d+ error', '\\d+ warning',
    ],
    groupByFile: true,
    diagnosticPattern: '^(?<file>[^:]+\\.py):\\d+:\\d+',
    maxDiagnosticsPerFile: 10,
  },

  // ─── Misc Tools ────────────────────────────────────────────────────
  {
    id: 'ping',
    displayName: 'Ping',
    version: '1.0.0',
    commandPatterns: ['^ping\\b'],
    suppressPatterns: [
      '^\\d+ bytes from',
      '^Reply from',
    ],
    importantPatterns: [
      'packet loss', 'statistics', 'avg',
      'Request timed out', 'Destination .* unreachable',
      'min/avg/max', 'Packets:',
    ],
  },
  {
    id: 'curl-verbose',
    displayName: 'Curl',
    version: '1.0.0',
    commandPatterns: ['^curl\\b'],
    suppressPatterns: [
      '^\\s*%\\s+Total',
      '^\\s*\\d+\\s+\\d+',
      '^[\\s*]*Trying',
      '^[\\s*]*Connected to',
      '^[\\s*]*TCP_NODELAY',
      '^[\\s*]*SSL connection using',
      '^[\\s*]*Server certificate:',
      '^[\\s*]*subject:',
      '^[\\s*]*issuer:',
    ],
    importantPatterns: [
      'HTTP/', 'error', 'curl:',
      '< HTTP', '> (GET|POST|PUT|DELETE|PATCH)',
    ],
  },
  {
    id: 'wget',
    displayName: 'Wget',
    version: '1.0.0',
    commandPatterns: ['^wget\\b'],
    suppressPatterns: [
      '^\\s*\\d+K\\s+\\.+',
      '\\d+%\\s+\\d+',
    ],
    importantPatterns: [
      'error', 'ERROR', 'saved',
      'HTTP request sent', 'Length:',
      'Saving to:', 'failed',
    ],
  },
  {
    id: 'rsync',
    displayName: 'Rsync',
    version: '1.0.0',
    commandPatterns: ['^rsync\\b'],
    suppressPatterns: [
      '^\\s*sending incremental',
      '^\\s*sent\\s+\\d+\\s+bytes',
      '^\\s*total size is',
    ],
    importantPatterns: [
      'error', 'rsync error', 'rsync:',
      'Number of files:', 'total size',
    ],
  },
  {
    id: 'du-df',
    displayName: 'Disk Usage',
    version: '1.0.0',
    commandPatterns: ['^(du|df)\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'Filesystem', 'total', '100%',
    ],
  },
  {
    id: 'pre-commit',
    displayName: 'Pre-commit',
    version: '1.0.0',
    commandPatterns: ['^pre-commit\\s+run\\b'],
    suppressPatterns: [
      '^\\s*\\[INFO\\]\\s+Initializing',
      '^\\s*\\[INFO\\]\\s+Installing',
    ],
    importantPatterns: [
      'Failed', 'Passed', 'Skipped',
      'hook id', 'files were modified',
    ],
  },

  // ─── Package managers (non-JS) ─────────────────────────────────────
  {
    id: 'brew-install',
    displayName: 'Homebrew',
    version: '1.0.0',
    commandPatterns: ['^brew\\s+(install|upgrade|update)\\b'],
    suppressPatterns: [
      '^==> Downloading',
      '^==> Fetching',
      '^\\s*###',
      '^Already downloaded:',
    ],
    importantPatterns: [
      'Error:', 'Warning:',
      '==> Pouring', '==> Installing',
      'already installed', 'Caveats',
    ],
  },
  {
    id: 'composer',
    displayName: 'Composer',
    version: '1.0.0',
    commandPatterns: ['^composer\\s+(install|update|require)\\b'],
    suppressPatterns: [
      '^\\s*-\\s+Downloading\\s+',
      '^\\s*-\\s+Installing\\s+',
      '^Loading composer repositories',
      '^Updating dependencies',
    ],
    importantPatterns: [
      'error', 'Warning:', 'Nothing to install',
      'Lock file operations:', 'Package operations:',
      'Generating autoload', 'failed',
    ],
  },

  // ─── Task runners ──────────────────────────────────────────────────
  {
    id: 'turbo',
    displayName: 'Turbo',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?turbo\\s+run\\b', '^turbo\\b'],
    suppressPatterns: [
      '^\\s*cache (hit|miss|bypass)',
    ],
    importantPatterns: [
      'error', 'FAILED', 'Tasks:', 'Duration:',
      '\\d+ successful', '\\d+ failed',
    ],
  },
  {
    id: 'nx',
    displayName: 'NX',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?nx\\s+'],
    suppressPatterns: [
      '^\\s*>\\s+nx\\s+run\\s+',
    ],
    importantPatterns: [
      'Successfully ran', 'Failed to run',
      '\\d+ succeeded', '\\d+ failed',
      'error', 'NX',
    ],
  },
  {
    id: 'just',
    displayName: 'Just',
    version: '1.0.0',
    commandPatterns: ['^just\\b'],
    suppressPatterns: [],
    importantPatterns: [
      'error:', 'Recipe .* failed',
    ],
  },

  // ─── Next.js / Vite build ─────────────────────────────────────────
  {
    id: 'next-build',
    displayName: 'Next.js Build',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?next\\s+build\\b'],
    suppressPatterns: [
      '^\\s*Compiling\\s+',
      '^\\s*\\.next/',
      '^\\s*Creating an optimized production build',
      '^\\s*Collecting page data',
      '^\\s*Generating static pages',
      '^\\s*Finalizing page optimization',
    ],
    importantPatterns: [
      'Error:', 'error:', 'Failed to compile',
      'Route.*Size.*First Load',
      'First Load JS shared',
      'Build error occurred',
      '\\+\\s+First Load JS',
    ],
  },
  {
    id: 'vite-build',
    displayName: 'Vite Build',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?vite\\s+build\\b'],
    suppressPatterns: [
      '^\\s*transforming\\s+',
      '^\\s*rendering\\s+chunks',
      '^\\s*computing\\s+gzip',
    ],
    importantPatterns: [
      'error', 'warning', 'built in',
      '\\d+ modules transformed',
      'dist/',
    ],
  },

  // ─── Prisma ────────────────────────────────────────────────────────
  {
    id: 'prisma',
    displayName: 'Prisma',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?prisma\\s+(generate|migrate|db|studio|validate|format)\\b'],
    suppressPatterns: [
      '^\\s*Prisma schema loaded',
      '^\\s*Datasource',
    ],
    importantPatterns: [
      'Error:', 'error', 'Generated',
      'applied successfully', 'migration created',
      'database reset', 'Your database is now in sync',
    ],
  },

  // ─── Playwright ────────────────────────────────────────────────────
  {
    id: 'playwright',
    displayName: 'Playwright',
    version: '1.0.0',
    commandPatterns: ['^(npx\\s+)?playwright\\s+test\\b'],
    suppressPatterns: [
      '^\\s*Running\\s+\\d+\\s+test',
    ],
    importantPatterns: [
      'failed', 'passed', 'skipped', 'flaky',
      '\\d+ passed', '\\d+ failed',
      'Error:', 'expect\\(', 'Timeout',
      'retry #', 'attachment',
    ],
  },

  // ─── Swift / Xcode ─────────────────────────────────────────────────
  {
    id: 'swift-build',
    displayName: 'Swift Build',
    version: '1.0.0',
    commandPatterns: ['^swift\\s+(build|test|run)\\b'],
    suppressPatterns: [
      '^Compiling\\s+',
      '^Linking\\s+',
      '^Fetching\\s+',
      '^Resolving\\s+',
    ],
    importantPatterns: [
      'error:', 'warning:', 'note:',
      'Build complete', 'FAILED',
      'test\\s+.*passed', 'test\\s+.*failed',
    ],
  },
  {
    id: 'xcodebuild',
    displayName: 'Xcode Build',
    version: '1.0.0',
    commandPatterns: ['^xcodebuild\\b'],
    suppressPatterns: [
      '^\\s*CompileC\\s+',
      '^\\s*Ld\\s+',
      '^\\s*ProcessInfoPlistFile',
      '^\\s*CopySwiftLibs',
      '^\\s*CodeSign\\s+',
      '^\\s*Touching\\s+',
    ],
    importantPatterns: [
      'error:', 'warning:', 'BUILD SUCCEEDED', 'BUILD FAILED',
      'Test Suite.*passed', 'Test Suite.*failed',
      'Failing Tests:', 'TEST FAILED',
    ],
  },
];
