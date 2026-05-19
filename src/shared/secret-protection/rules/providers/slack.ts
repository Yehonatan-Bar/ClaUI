import { RulePackDefinition } from '../types';

export const slackRulePack: RulePackDefinition = {
  id: 'provider-slack',
  name: 'Slack Tokens',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'slack-bot-token',
      type: 'api_key',
      pattern: /xoxb-[A-Za-z0-9-]+/g,
      severity: 'high',
      description: 'Slack bot token',
      scanner: 'regex-rule',
    },
    {
      id: 'slack-user-token',
      type: 'api_key',
      pattern: /xoxp-[A-Za-z0-9-]+/g,
      severity: 'high',
      description: 'Slack user token',
      scanner: 'regex-rule',
    },
    {
      id: 'slack-app-token',
      type: 'api_key',
      pattern: /xapp-[A-Za-z0-9-]+/g,
      severity: 'high',
      description: 'Slack app-level token',
      scanner: 'regex-rule',
    },
    {
      id: 'slack-webhook-url',
      type: 'webhook',
      pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
      severity: 'high',
      description: 'Slack incoming webhook URL',
      scanner: 'regex-rule',
    },
  ],
};

export default slackRulePack;
