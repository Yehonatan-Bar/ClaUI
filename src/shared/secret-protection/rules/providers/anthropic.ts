import { RulePackDefinition } from '../types';

export const anthropicRulePack: RulePackDefinition = {
  id: 'provider-anthropic',
  name: 'Anthropic Keys',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'anthropic-api-key',
      type: 'api_key',
      pattern: /sk-ant-[A-Za-z0-9-]{20,}/g,
      severity: 'high',
      description: 'Anthropic API key',
      scanner: 'regex-rule',
    },
  ],
};

export default anthropicRulePack;
