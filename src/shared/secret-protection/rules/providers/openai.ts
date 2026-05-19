import { RulePackDefinition } from '../types';

export const openaiRulePack: RulePackDefinition = {
  id: 'provider-openai',
  name: 'OpenAI Keys',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'openai-api-key',
      type: 'api_key',
      pattern: /sk-[A-Za-z0-9]{20,}/g,
      severity: 'high',
      description: 'OpenAI API key',
      scanner: 'regex-rule',
    },
    {
      id: 'openai-org-id',
      type: 'api_key',
      pattern: /org-[A-Za-z0-9]{24}/g,
      severity: 'low',
      description: 'OpenAI organization ID',
      scanner: 'regex-rule',
    },
  ],
};

export default openaiRulePack;
