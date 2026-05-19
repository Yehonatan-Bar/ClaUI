import { RulePackDefinition } from '../types';

export const exfiltrationRulePack: RulePackDefinition = {
  id: 'commands-exfiltration',
  name: 'Data Exfiltration Commands',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'cmd-curl-upload',
      type: 'network_exfil_primitive',
      pattern: /\bcurl\s+.*(?:-d\b|--data\b|-X\s*(?:POST|PUT|PATCH)\b|--upload-file\b)/g,
      severity: 'high',
      description: 'curl command sending data to remote',
      scanner: 'regex-rule',
    },
    {
      id: 'cmd-wget-post',
      type: 'network_exfil_primitive',
      pattern: /\bwget\s+.*--post-(?:data|file)\b/g,
      severity: 'high',
      description: 'wget command posting data to remote',
      scanner: 'regex-rule',
    },
    {
      id: 'cmd-netcat',
      type: 'network_exfil_primitive',
      pattern: /\b(?:nc|ncat|netcat)\s+/g,
      severity: 'high',
      description: 'Netcat network utility',
      scanner: 'regex-rule',
    },
    {
      id: 'cmd-pipe-to-remote',
      type: 'network_exfil_primitive',
      pattern: /\|\s*(?:curl|wget|nc|ssh|scp)\b/g,
      severity: 'high',
      description: 'Pipe output to network command',
      scanner: 'regex-rule',
    },
  ],
};

export default exfiltrationRulePack;
