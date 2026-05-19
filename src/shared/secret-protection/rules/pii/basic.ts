import { RulePackDefinition } from '../types';

export const piiBasicRulePack: RulePackDefinition = {
  id: 'pii-basic',
  name: 'Basic PII',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'pii-email',
      type: 'pii',
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      severity: 'medium',
      description: 'Email address',
      scanner: 'pii-topology',
    },
    {
      id: 'pii-phone-us',
      type: 'pii',
      pattern: /(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      severity: 'medium',
      description: 'US phone number',
      scanner: 'pii-topology',
    },
    {
      id: 'pii-ssn',
      type: 'pii',
      pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
      severity: 'high',
      description: 'US Social Security Number',
      scanner: 'pii-topology',
    },
  ],
};

export default piiBasicRulePack;
