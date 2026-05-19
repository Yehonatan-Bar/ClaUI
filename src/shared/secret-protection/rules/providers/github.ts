import { RulePackDefinition } from '../types';

export const githubRulePack: RulePackDefinition = {
  id: 'provider-github',
  name: 'GitHub Tokens',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'github-classic-pat',
      type: 'api_key',
      pattern: /ghp_[A-Za-z0-9]{36}/g,
      severity: 'high',
      description: 'GitHub classic personal access token',
      scanner: 'regex-rule',
    },
    {
      id: 'github-fine-grained-pat',
      type: 'api_key',
      pattern: /github_pat_[A-Za-z0-9_]{82}/g,
      severity: 'high',
      description: 'GitHub fine-grained personal access token',
      scanner: 'regex-rule',
    },
    {
      id: 'github-oauth',
      type: 'api_key',
      pattern: /gho_[A-Za-z0-9]{36}/g,
      severity: 'high',
      description: 'GitHub OAuth access token',
      scanner: 'regex-rule',
    },
    {
      id: 'github-app-token',
      type: 'api_key',
      pattern: /(?:ghs|ghu)_[A-Za-z0-9]{36}/g,
      severity: 'high',
      description: 'GitHub App installation or user-to-server token',
      scanner: 'regex-rule',
    },
  ],
};

export default githubRulePack;
