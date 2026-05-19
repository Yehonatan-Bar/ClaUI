import { RulePackDefinition } from '../types';

export const protectedPathsRulePack: RulePackDefinition = {
  id: 'files-protected',
  name: 'Protected File Paths',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'protected-env-file',
      type: 'protected_path',
      severity: 'critical',
      description: '.env and .env.* files',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-private-key',
      type: 'protected_path',
      severity: 'critical',
      description: 'PEM, KEY, P12, PFX private key files',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-ssh-dir',
      type: 'protected_path',
      severity: 'critical',
      description: '.ssh directory contents',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-cloud-config',
      type: 'protected_path',
      severity: 'high',
      description: '.aws, .azure, .kube config directories',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-terraform-state',
      type: 'protected_path',
      severity: 'high',
      description: 'Terraform state files',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-secrets-json',
      type: 'protected_path',
      severity: 'high',
      description: 'secrets.json and credentials files',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-agent-control',
      type: 'agent_control_file',
      severity: 'medium',
      description: '.claude, .codex, .cursor control directories',
      scanner: 'path-sensitivity',
    },
    {
      id: 'protected-git-control',
      type: 'git_control_file',
      severity: 'medium',
      description: '.git directory contents',
      scanner: 'path-sensitivity',
    },
  ],
};

export default protectedPathsRulePack;
