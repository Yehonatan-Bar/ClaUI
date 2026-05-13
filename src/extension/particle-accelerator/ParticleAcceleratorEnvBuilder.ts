import * as path from 'path';
import { ParticleAcceleratorEnvInput } from './ParticleAcceleratorTypes';

const TELEMETRY_VARS_TO_REMOVE = [
  /^BOOST_/i,
  /^JFROG_/i,
  /^OTEL_EXPORTER_/i,
  /^OTEL_TRACES_EXPORTER$/i,
  /^OTEL_METRICS_EXPORTER$/i,
];

export function buildParticleAcceleratorAgentEnv(input: ParticleAcceleratorEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.baseEnv };

  // Prepend binDir to PATH
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const currentPath = env.PATH ?? env.Path ?? '';
  env.CLAUI_PARTICLE_ACCELERATOR_ORIGINAL_PATH = currentPath;
  env.PATH = input.binDir + pathSep + currentPath;
  if (process.platform === 'win32') {
    env.Path = env.PATH;
  }

  // Set Particle Accelerator env vars
  env.CLAUI_PARTICLE_ACCELERATOR = '1';
  env.CLAUI_PARTICLE_ACCELERATOR_VERSION = '1.0.0';
  env.CLAUI_PARTICLE_ACCELERATOR_PROVIDER = input.provider;
  env.CLAUI_PARTICLE_ACCELERATOR_WORKSPACE = input.workspacePath;
  env.CLAUI_PARTICLE_ACCELERATOR_TAB_RUNTIME_ID = input.tabRuntimeId;
  env.CLAUI_PARTICLE_ACCELERATOR_STORE_DIR = input.storeDir;
  env.CLAUI_PARTICLE_ACCELERATOR_CONTEXT_FILE = input.contextFilePath;

  if (input.sessionId) {
    env.CLAUI_PARTICLE_ACCELERATOR_SESSION_ID = input.sessionId;
  }
  if (input.shell) {
    env.CLAUI_PARTICLE_ACCELERATOR_SHELL = input.shell;
  }
  if (input.filterProfile) {
    env.CLAUI_PARTICLE_ACCELERATOR_FILTER_PROFILE = input.filterProfile;
  }
  if (input.storeRawLogs !== undefined) {
    env.CLAUI_PARTICLE_ACCELERATOR_STORE_RAW_LOGS = input.storeRawLogs ? 'true' : 'false';
  }

  // Remove external telemetry vars
  for (const key of Object.keys(env)) {
    if (TELEMETRY_VARS_TO_REMOVE.some(p => p.test(key))) {
      delete env[key];
    }
  }

  // Verify node is available
  const nodePath = findNode(env);
  if (!nodePath) {
    throw new Error(
      'Node.js not found in PATH. Particle Accelerator requires Node.js to run the claui-run CLI. ' +
      'Please install Node.js or ensure it is in your PATH.',
    );
  }

  return env;
}

function findNode(env: NodeJS.ProcessEnv): string | null {
  const isWindows = process.platform === 'win32';
  const pathVar = env.PATH ?? env.Path ?? '';
  const dirs = pathVar.split(isWindows ? ';' : ':');
  const names = isWindows ? ['node.exe', 'node.cmd'] : ['node'];

  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const fs = require('fs');
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        continue;
      }
    }
  }
  return null;
}
