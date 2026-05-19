import { RulePackDefinition } from '../types';

export const stripeRulePack: RulePackDefinition = {
  id: 'provider-stripe',
  name: 'Stripe Keys',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'stripe-secret-key',
      type: 'api_key',
      pattern: /sk_(live|test)_[A-Za-z0-9]{20,}/g,
      severity: 'critical',
      description: 'Stripe secret API key',
      scanner: 'regex-rule',
    },
    {
      id: 'stripe-restricted-key',
      type: 'api_key',
      pattern: /rk_(live|test)_[A-Za-z0-9]{20,}/g,
      severity: 'high',
      description: 'Stripe restricted API key',
      scanner: 'regex-rule',
    },
    {
      id: 'stripe-webhook-secret',
      type: 'webhook',
      pattern: /whsec_[A-Za-z0-9]{32,}/g,
      severity: 'high',
      description: 'Stripe webhook signing secret',
      scanner: 'regex-rule',
    },
  ],
};

export default stripeRulePack;
