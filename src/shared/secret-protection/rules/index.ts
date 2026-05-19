import { RulePackDefinition } from './types';
import { awsRulePack } from './cloud/aws';
import { gcpRulePack } from './cloud/gcp';
import { azureRulePack } from './cloud/azure';
import { githubRulePack } from './providers/github';
import { openaiRulePack } from './providers/openai';
import { anthropicRulePack } from './providers/anthropic';
import { slackRulePack } from './providers/slack';
import { stripeRulePack } from './providers/stripe';
import { gitRulePack } from './vcs/git';
import { protectedPathsRulePack } from './files/protectedPaths';
import { piiBasicRulePack } from './pii/basic';
import { internalTopologyRulePack } from './topology/internal';
import { exfiltrationRulePack } from './commands/exfiltration';

const ALL_PACKS: RulePackDefinition[] = [
  awsRulePack,
  gcpRulePack,
  azureRulePack,
  githubRulePack,
  openaiRulePack,
  anthropicRulePack,
  slackRulePack,
  stripeRulePack,
  gitRulePack,
  protectedPathsRulePack,
  piiBasicRulePack,
  internalTopologyRulePack,
  exfiltrationRulePack,
];

export function getRulePack(id: string): RulePackDefinition | undefined {
  return ALL_PACKS.find(pack => pack.id === id);
}

export function getAllRulePacks(): RulePackDefinition[] {
  return ALL_PACKS;
}

export function getEnabledRulePacks(): RulePackDefinition[] {
  return ALL_PACKS.filter(pack => pack.enabled);
}
