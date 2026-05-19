import { DlpBoundary, DlpDestination, DestinationKind, TrustTier } from './types';

export interface DestinationMetadata {
  provider?: 'anthropic' | 'openai' | 'github' | 'other';
  host?: string;
  remoteName?: string;
  mcpServerUrl?: string;
  isAuthenticated?: boolean;
}

const KNOWN_GIT_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'dev.azure.com',
]);

interface BoundaryMapping {
  kind: DestinationKind;
  remote: boolean | 'depends';
}

const BOUNDARY_MAP: Record<DlpBoundary, BoundaryMapping> = {
  'prompt.submit': { kind: 'remote_model_provider', remote: true },
  'context.attach': { kind: 'remote_model_provider', remote: true },
  'file.read_for_context': { kind: 'remote_model_provider', remote: true },
  'command.preflight': { kind: 'terminal_stdout_to_agent', remote: false },
  'command.output': { kind: 'terminal_stdout_to_agent', remote: false },
  'git.diff': { kind: 'local_disk', remote: false },
  'git.publish': { kind: 'git_remote', remote: true },
  'mcp.request': { kind: 'mcp_server', remote: 'depends' },
  'mcp.response': { kind: 'mcp_server', remote: 'depends' },
  'browser.capture': { kind: 'browser_context', remote: false },
  'persistence.write': { kind: 'local_disk', remote: false },
  'telemetry.export': { kind: 'telemetry_backend', remote: true },
  'diagnostic.export': { kind: 'diagnostic_export', remote: 'depends' },
};

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.startsWith('localhost:') ||
    lower.startsWith('127.0.0.1:') ||
    lower.startsWith('::1:')
  );
}

function resolveRemote(mapping: BoundaryMapping, metadata: DestinationMetadata): boolean {
  if (mapping.remote !== 'depends') return mapping.remote;

  if (mapping.kind === 'mcp_server') {
    if (metadata.mcpServerUrl) {
      try {
        const url = new URL(metadata.mcpServerUrl);
        return !isLocalHost(url.hostname);
      } catch {
        // Fall through to host check.
      }
    }
    return !isLocalHost(metadata.host);
  }

  // diagnostic.export: remote unless host is local
  return !isLocalHost(metadata.host);
}

function resolveTrustTier(
  kind: DestinationKind,
  remote: boolean,
  metadata: DestinationMetadata
): TrustTier {
  // Local destinations are trusted.
  if (kind === 'local_disk' || kind === 'terminal_stdout_to_agent') {
    return 'trusted_local';
  }

  // Known model providers are trusted org.
  if (kind === 'remote_model_provider') {
    if (metadata.provider === 'anthropic' || metadata.provider === 'openai') {
      return 'trusted_org';
    }
    if (metadata.provider === 'github') {
      return 'approved_remote';
    }
    return 'unknown_remote';
  }

  // Browser context is local.
  if (kind === 'browser_context') {
    return 'trusted_local';
  }

  // MCP servers: local ones are approved, remote depends on host.
  if (kind === 'mcp_server') {
    if (!remote) {
      return 'approved_remote';
    }
    // Check if the host is known.
    if (metadata.host && KNOWN_GIT_HOSTS.has(metadata.host.toLowerCase())) {
      return 'approved_remote';
    }
    return 'unknown_remote';
  }

  // Git remotes: check host.
  if (kind === 'git_remote') {
    if (metadata.host && KNOWN_GIT_HOSTS.has(metadata.host.toLowerCase())) {
      return 'approved_remote';
    }
    return 'unknown_remote';
  }

  // Telemetry and diagnostic exports to unknown destinations are public.
  if (kind === 'telemetry_backend' || kind === 'diagnostic_export') {
    if (isLocalHost(metadata.host)) {
      return 'trusted_local';
    }
    return 'public';
  }

  return 'unknown_remote';
}

export function classifyDestination(
  boundary: DlpBoundary,
  metadata: DestinationMetadata
): DlpDestination {
  const mapping = BOUNDARY_MAP[boundary];
  const remote = resolveRemote(mapping, metadata);
  const trustTier = resolveTrustTier(mapping.kind, remote, metadata);

  return {
    kind: mapping.kind,
    provider: metadata.provider,
    remote,
    host: metadata.host,
    trustTier,
  };
}
