import { RulePackDefinition } from '../types';

export const awsRulePack: RulePackDefinition = {
  id: 'cloud-aws',
  name: 'AWS Credentials',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'aws-access-key-id',
      type: 'cloud_credential',
      pattern: /AKIA[0-9A-Z]{16}/g,
      severity: 'critical',
      description: 'AWS Access Key ID',
      scanner: 'regex-rule',
    },
    {
      id: 'aws-secret-access-key',
      type: 'cloud_credential',
      pattern: /(?<==\s*)[A-Za-z0-9/+=]{40}(?=\s|$)/g,
      severity: 'critical',
      description: 'AWS Secret Access Key',
      scanner: 'regex-rule',
    },
    {
      id: 'aws-session-token',
      type: 'cloud_credential',
      pattern: /(?:aws_session_token|AWS_SESSION_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9/+=]{100,}["']?/g,
      severity: 'critical',
      description: 'AWS Session Token',
      scanner: 'regex-rule',
    },
    {
      id: 'aws-arn-role',
      type: 'cloud_credential',
      pattern: /arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@-]+/g,
      severity: 'medium',
      description: 'AWS IAM Role ARN',
      scanner: 'regex-rule',
    },
  ],
};

export default awsRulePack;
