/**
 * Detects team creation/deletion in CLI stream output by scanning
 * assistantMessage content blocks for TeamCreate/TeamDelete tool_use calls.
 */

import type { ContentBlock } from '../types/stream-json';

export interface TeamDetection {
  action: 'create' | 'delete';
  teamName: string;
}

export class TeamDetector {
  /**
   * Scan an array of content blocks for TeamCreate or TeamDelete tool_use calls.
   * Returns detection info if found, or null.
   */
  detectTeamActivity(contentBlocks: ContentBlock[]): TeamDetection | null {
    if (!Array.isArray(contentBlocks)) return null;

    for (const block of contentBlocks) {
      if (block.type !== 'tool_use') continue;

      const name = (block as { name?: string }).name ?? '';
      const normalizedName = name.trim().toLowerCase();
      const input = (block as { input?: Record<string, unknown> }).input;

      if (normalizedName === 'teamcreate' || normalizedName.endsWith('.teamcreate')) {
        const teamName = (input?.team_name as string) || '';
        if (teamName) {
          return { action: 'create', teamName };
        }
      }

      if (normalizedName === 'teamdelete' || normalizedName.endsWith('.teamdelete')) {
        // TeamDelete doesn't always include team_name in input (uses session context)
        const teamName = (input?.team_name as string) || '';
        return { action: 'delete', teamName };
      }
    }

    return null;
  }
}
