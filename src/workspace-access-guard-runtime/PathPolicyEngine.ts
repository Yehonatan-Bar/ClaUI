import {
  WorkspaceAccessPolicyInput,
  WorkspaceAccessDecision,
  WorkspaceAccessOrgPolicy,
  WorkspaceAccessGuardSettings,
} from '../shared/workspace-access-guard/types';
import { normalizePath, normalizeMany, normalizeDeniedRoots, isPathInsideRoot } from './PathNormalizer';

export function evaluate(input: WorkspaceAccessPolicyInput): WorkspaceAccessDecision {
  const paths = input.extractedPaths.length > 0
    ? input.extractedPaths
    : shouldTreatCwdAsTarget(input) ? [input.cwd] : [];

  if (paths.length === 0 && isDirectFileOperation(input.operation)) {
    return {
      action: input.settings.mode === 'audit' ? 'audit' : 'deny',
      reason: 'File tool input did not include a parseable filesystem path',
      normalizedPaths: [],
      remediation: 'Workspace Access Guard blocked this action because the file tool request did not expose a path that could be checked against allowed and denied roots.',
    };
  }

  if (paths.length === 0 && isNoFileAccessOperation(input)) {
    return allow('No file paths detected and operation does not access files');
  }

  const normalizedTargets = normalizeMany(paths, input.cwd, input.env);
  const effectiveAllowedRoots = input.userAllowedRoots.filter(root => {
    return !isHardDeniedBroadRoot(root, input.orgPolicy, input.env);
  });
  const normalizedAllowedRoots = normalizeMany(effectiveAllowedRoots, input.cwd, input.env);
  const normalizedDenied = normalizeDeniedRoots(
    input.orgPolicy.deniedRoots,
    input.env,
  );

  const normalizedPaths = normalizedTargets.map(t => t.comparisonPath);

  if (input.settings.blockDeniedRoots) {
    for (const target of normalizedTargets) {
      for (const denied of normalizedDenied) {
        const absoluteComp = target.absolutePath.toLowerCase();
        if (
          matchesDeniedRoot(target.comparisonPath, denied) ||
          matchesDeniedRoot(absoluteComp, denied)
        ) {
          const matchedRule = input.orgPolicy.deniedRoots.find(
            r => r.path === denied.original,
          );
          return {
            action: input.settings.mode === 'audit' ? 'audit' : 'deny',
            reason: 'Target path is inside an organization-denied folder',
            matchedPath: target.original,
            matchedRuleId: matchedRule?.id,
            matchedRuleSource: 'organization-policy',
            normalizedPaths,
            remediation: buildDeniedRemediation(target.original, matchedRule?.description),
          };
        }
      }

      if (target.realPath) {
        const realComp = target.realPath.toLowerCase();
        for (const denied of normalizedDenied) {
          if (matchesDeniedRoot(realComp, denied)) {
            const matchedRule = input.orgPolicy.deniedRoots.find(
              r => r.path === denied.original,
            );
            return {
              action: input.settings.mode === 'audit' ? 'audit' : 'deny',
              reason: 'Resolved path (via symlink/junction) is inside an organization-denied folder',
              matchedPath: target.original,
              matchedRuleId: matchedRule?.id,
              matchedRuleSource: 'organization-policy',
              normalizedPaths,
              remediation: buildDeniedRemediation(target.original, matchedRule?.description),
            };
          }
        }
      }
    }
  }

  if (input.settings.blockOutsideAllowedRoots && paths.length > 0 && normalizedAllowedRoots.length === 0) {
    return {
      action: input.settings.mode === 'audit' ? 'audit' : 'deny',
      reason: 'No allowed working folders are configured',
      matchedPath: paths[0],
      matchedRuleSource: 'user-allowed-root',
      normalizedPaths,
      remediation: buildNoAllowedRootsRemediation(paths[0]),
    };
  }

  if (input.settings.blockOutsideAllowedRoots && normalizedAllowedRoots.length > 0) {
    for (const target of normalizedTargets) {
      const insideAllowed = normalizedAllowedRoots.some(
        root => isPathInsideRoot(target.comparisonPath, root.comparisonPath),
      );

      if (!insideAllowed) {
        let realInsideAllowed = false;
        if (target.realPath) {
          const realComp = target.realPath.toLowerCase();
          realInsideAllowed = normalizedAllowedRoots.some(
            root => isPathInsideRoot(realComp, root.comparisonPath),
          );
        }

        if (!realInsideAllowed) {
          return {
            action: input.settings.mode === 'audit' ? 'audit' : 'deny',
            reason: 'Target path is outside allowed working folders',
            matchedPath: target.original,
            matchedRuleSource: 'user-allowed-root',
            normalizedPaths,
            remediation: buildOutsideRootsRemediation(target.original, effectiveAllowedRoots),
          };
        }
      }
    }
  }

  if (input.settings.denyUnresolvedSymlinkTargets) {
    for (const target of normalizedTargets) {
      if (target.warnings.some(w => w.includes('symlink'))) {
        if (!target.realPath) {
          return {
            action: input.settings.mode === 'audit' ? 'audit' : 'deny',
            reason: 'Path traverses an unresolved symlink or junction',
            matchedPath: target.original,
            normalizedPaths,
          };
        }
      }
    }
  }

  if (input.operation === 'unknown' && input.settings.denyUnknownFileAccessCommands) {
    return {
      action: input.settings.mode === 'audit' ? 'audit' : 'deny',
      reason: 'File-access command could not be safely parsed',
      normalizedPaths,
    };
  }

  return allow('All target paths are inside allowed roots and outside denied roots', normalizedPaths);
}

export function checkBroadRoot(
  rootPath: string,
  policy: WorkspaceAccessOrgPolicy,
  env: Record<string, string | undefined>,
): { isBroad: boolean; warning?: string } {
  const normalized = normalizePath(rootPath, '', env);
  const comp = normalized.comparisonPath;
  const broadRules = policy.broadRootRules;

  if (!broadRules) return { isBroad: false };

  if (broadRules.denyDriveRoot && /^[a-z]:\\?$/.test(comp)) {
    return { isBroad: true, warning: 'Adding a whole drive root gives Claude/Codex access to the entire drive. Add a project-specific subfolder instead.' };
  }

  const userProfile = (env.USERPROFILE ?? '').toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
  const usersFolder = userProfile ? userProfile.replace(/\\[^\\]+$/, '') : '';

  if (broadRules.denyWholeUsersFolder && comp === usersFolder) {
    return { isBroad: true, warning: 'Adding the entire Users folder gives access to all user profiles. Add a project-specific subfolder instead.' };
  }

  if (broadRules.denyWholeUserProfile && comp === userProfile) {
    return { isBroad: true, warning: 'Adding the entire user profile gives Claude/Codex access to credentials, browser data, SSH keys, and more. Add a project-specific subfolder instead.' };
  }

  if (broadRules.warnOnDocumentsDesktopDownloads) {
    const broadFolders = ['documents', 'desktop', 'downloads'];
    for (const folder of broadFolders) {
      if (comp === `${userProfile}\\${folder}`) {
        return { isBroad: true, warning: `This is a broad user-data folder. Claude/Codex commands may scan personal or sensitive documents. Recommended: add a project-specific subfolder instead.` };
      }
    }
  }

  return { isBroad: false };
}

export function isHardDeniedBroadRoot(
  rootPath: string,
  policy: WorkspaceAccessOrgPolicy,
  env: Record<string, string | undefined>,
): boolean {
  const normalized = normalizePath(rootPath, '', env);
  const comp = normalized.comparisonPath;
  const broadRules = policy.broadRootRules;

  if (!broadRules) return false;

  if (broadRules.denyDriveRoot && /^[a-z]:\\?$/.test(comp)) {
    return true;
  }

  const userProfile = (env.USERPROFILE ?? '').toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
  const usersFolder = userProfile ? userProfile.replace(/\\[^\\]+$/, '') : '';

  if (broadRules.denyWholeUsersFolder && comp === usersFolder) {
    return true;
  }

  if (broadRules.denyWholeUserProfile && comp === userProfile) {
    return true;
  }

  return false;
}

function shouldTreatCwdAsTarget(input: WorkspaceAccessPolicyInput): boolean {
  if (input.operation === 'bash' || input.operation === 'search') return true;
  if (input.operation === 'unknown') return true;
  return false;
}

function isNoFileAccessOperation(input: WorkspaceAccessPolicyInput): boolean {
  return input.operation === 'mcp';
}

function isDirectFileOperation(operation: WorkspaceAccessPolicyInput['operation']): boolean {
  return operation === 'read' ||
    operation === 'search' ||
    operation === 'list' ||
    operation === 'write' ||
    operation === 'delete';
}

function allow(reason: string, normalizedPaths: string[] = []): WorkspaceAccessDecision {
  return { action: 'allow', reason, normalizedPaths };
}

function buildDeniedRemediation(blockedPath: string, ruleDescription?: string): string {
  return `Workspace Access Guard blocked this action.\n\nReason:\nThe target path is protected by the organization policy.\n\nBlocked path:\n${blockedPath}\nMatched policy rule:\n${ruleDescription ?? 'Organization denied root'}\n\nRequired fix:\nDo not read, search, write, or copy files from this protected location. Use files inside the approved project workspace only.`;
}

function buildOutsideRootsRemediation(blockedPath: string, allowedRoots: string[]): string {
  return `Workspace Access Guard blocked this action.\n\nReason:\nThe target path is outside the folders that the user approved for Claude/Codex access.\n\nBlocked path:\n${blockedPath}\n\nAllowed working folders:\n${allowedRoots.join('\n')}\n\nRequired fix:\nUse a file under one of the allowed working folders, or ask the user to add the relevant project folder in Tools -> Workspace Access Guard.`;
}

function buildNoAllowedRootsRemediation(blockedPath: string): string {
  return `Workspace Access Guard blocked this action.\n\nReason:\nNo allowed working folders are configured for Claude/Codex access.\n\nBlocked path:\n${blockedPath}\n\nRequired fix:\nAdd the current project folder in Tools -> Workspace Access Guard before accessing files.`;
}

function matchesDeniedRoot(
  targetComparisonPath: string,
  denied: { comparisonPath: string; isGlob: boolean; regex?: RegExp },
): boolean {
  if (denied.isGlob && denied.regex) {
    return denied.regex.test(targetComparisonPath);
  }
  return isPathInsideRoot(targetComparisonPath, denied.comparisonPath);
}
