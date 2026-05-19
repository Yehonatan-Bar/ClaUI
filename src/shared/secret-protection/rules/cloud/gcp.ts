import { RulePackDefinition } from '../types';

export const gcpRulePack: RulePackDefinition = {
  id: 'cloud-gcp',
  name: 'GCP Credentials',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'gcp-service-account-json',
      type: 'cloud_credential',
      pattern: /"type"\s*:\s*"service_account"/g,
      severity: 'critical',
      description: 'GCP service account JSON key file',
      scanner: 'structured-payload',
    },
    {
      id: 'gcp-api-key',
      type: 'api_key',
      pattern: /AIza[A-Za-z0-9_-]{35}/g,
      severity: 'high',
      description: 'GCP API Key',
      scanner: 'regex-rule',
    },
    {
      id: 'gcp-oauth-token',
      type: 'api_key',
      pattern: /ya29\.[A-Za-z0-9_-]{50,}/g,
      severity: 'high',
      description: 'GCP OAuth access token',
      scanner: 'regex-rule',
    },
  ],
};

export default gcpRulePack;
