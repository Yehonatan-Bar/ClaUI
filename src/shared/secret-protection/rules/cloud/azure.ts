import { RulePackDefinition } from '../types';

export const azureRulePack: RulePackDefinition = {
  id: 'cloud-azure',
  name: 'Azure Credentials',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'azure-connection-string',
      type: 'cloud_credential',
      pattern: /(?:AccountKey|SharedAccessKey)\s*=\s*[A-Za-z0-9+/=]{40,}/g,
      severity: 'critical',
      description: 'Azure connection string with key',
      scanner: 'regex-rule',
    },
    {
      id: 'azure-sas-token',
      type: 'cloud_credential',
      pattern: /[?&]sig=[A-Za-z0-9%+/=]{40,}/g,
      severity: 'high',
      description: 'Azure SAS token signature',
      scanner: 'regex-rule',
    },
    {
      id: 'azure-client-secret',
      type: 'cloud_credential',
      pattern: /(?:client_secret|AZURE_CLIENT_SECRET)\s*[=:]\s*["']?[A-Za-z0-9_~.-]{30,}["']?/g,
      severity: 'critical',
      description: 'Azure client secret',
      scanner: 'regex-rule',
    },
  ],
};

export default azureRulePack;
