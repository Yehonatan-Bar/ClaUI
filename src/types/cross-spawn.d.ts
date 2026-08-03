declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'child_process';

  function crossSpawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess;

  export = crossSpawn;
}
