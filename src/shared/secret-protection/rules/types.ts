import { FindingSeverity, FindingType } from '../types';

export interface RuleDefinition {
  id: string;
  pattern?: RegExp;
  type?: FindingType;
  severity: FindingSeverity;
  description: string;
  scanner: string;
}

export interface RulePackDefinition {
  id: string;
  name: string;
  version: string;
  rules: RuleDefinition[];
  enabled: boolean;
}
