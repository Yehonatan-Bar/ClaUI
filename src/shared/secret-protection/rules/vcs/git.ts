import { RulePackDefinition } from '../types';

export const gitRulePack: RulePackDefinition = {
  id: 'vcs-git',
  name: 'Git Credentials',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'git-credential-url',
      type: 'database_credential',
      pattern: /https?:\/\/[^:@\s]+:[^@\s]+@[^\s]+\.git/g,
      severity: 'critical',
      description: 'Git URL with embedded credentials',
      scanner: 'regex-rule',
    },
    {
      id: 'git-credential-helper-output',
      type: 'hard_secret',
      pattern: /password\s*=\s*\S{8,}/g,
      severity: 'high',
      description: 'Git credential helper password output',
      scanner: 'regex-rule',
    },
  ],
};

export default gitRulePack;
