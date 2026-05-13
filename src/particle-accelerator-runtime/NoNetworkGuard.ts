export function enforceNoNetwork(): void {
  const blockedMessage = '[claui-particle-accelerator] Network access is blocked in the Particle Accelerator runner.';

  // Block global fetch
  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = () => {
      throw new Error(blockedMessage);
    };
  }

  // Block http/https/net/dgram via require override (defense-in-depth)
  const blockedModules = ['http', 'https', 'net', 'dgram', 'http2'];
  const originalRequire = module.constructor.prototype.require;

  module.constructor.prototype.require = function (id: string) {
    if (blockedModules.includes(id)) {
      throw new Error(`${blockedMessage} Attempted to require('${id}').`);
    }
    return originalRequire.apply(this, [id]);
  };
}
