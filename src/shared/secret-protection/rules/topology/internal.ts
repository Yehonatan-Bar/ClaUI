import { RulePackDefinition } from '../types';

export const internalTopologyRulePack: RulePackDefinition = {
  id: 'topology-internal',
  name: 'Internal Topology',
  version: '1.0.0',
  enabled: true,
  rules: [
    {
      id: 'internal-ip-rfc1918-10',
      type: 'internal_topology',
      pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
      severity: 'medium',
      description: 'RFC 1918 private IP (10.x.x.x)',
      scanner: 'pii-topology',
    },
    {
      id: 'internal-ip-rfc1918-172',
      type: 'internal_topology',
      pattern: /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g,
      severity: 'medium',
      description: 'RFC 1918 private IP (172.16-31.x.x)',
      scanner: 'pii-topology',
    },
    {
      id: 'internal-ip-rfc1918-192',
      type: 'internal_topology',
      pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g,
      severity: 'medium',
      description: 'RFC 1918 private IP (192.168.x.x)',
      scanner: 'pii-topology',
    },
    {
      id: 'internal-hostname',
      type: 'internal_topology',
      pattern: /\b[\w-]+\.(internal|corp|cluster\.local)\b/g,
      severity: 'medium',
      description: 'Internal hostname pattern',
      scanner: 'pii-topology',
    },
  ],
};

export default internalTopologyRulePack;
