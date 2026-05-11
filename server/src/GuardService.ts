import * as https from 'https';
import { Message, Participant, AgentLoopControlState } from './types';

export interface GuardConfig {
  apiKey: string;
  model: string;
  apiUrl?: string;
  timeoutMs?: number;
}

export type GuardResult = 'continue' | 'stop';

export class GuardService {
  private config: GuardConfig | null;
  private log: (msg: string) => void;

  constructor(config: GuardConfig | null, log?: (msg: string) => void) {
    this.config = config;
    this.log = log || console.log;
  }

  async check(
    sessionName: string,
    agents: Participant[],
    loopState: AgentLoopControlState,
    recentMessages: Message[],
    allParticipants: Participant[],
  ): Promise<GuardResult> {
    if (!this.config || !this.config.apiKey) {
      this.log('Guard: no API key configured, defaulting to STOP');
      return 'stop';
    }

    const prompt = this.buildPrompt(sessionName, agents, loopState, recentMessages, allParticipants);

    try {
      const response = await this.callModel(prompt);
      const trimmed = response.trim().toUpperCase();
      if (trimmed === 'CONTINUE') {
        this.log('Guard: CONTINUE');
        return 'continue';
      }
      this.log(`Guard: STOP (raw: "${response.substring(0, 100)}")`);
      return 'stop';
    } catch (err) {
      this.log(`Guard: error, defaulting to STOP: ${err}`);
      return 'stop';
    }
  }

  private buildPrompt(
    sessionName: string,
    agents: Participant[],
    loopState: AgentLoopControlState,
    recentMessages: Message[],
    allParticipants: Participant[],
  ): string {
    const agentNames = agents.map(a => a.displayName).join(', ');

    const messageLines = recentMessages.map(m => {
      const author = allParticipants.find(p => p.participantId === m.authorParticipantId);
      const recipient = m.recipientParticipantId
        ? allParticipants.find(p => p.participantId === m.recipientParticipantId)
        : null;
      const recipientPart = recipient ? ` -> ${recipient.displayName}` : '';
      const body = m.parsedBody.length > 300 ? m.parsedBody.substring(0, 300) + '...' : m.parsedBody;
      return `[${author?.displayName || 'unknown'}${recipientPart}]: ${body}`;
    }).join('\n');

    return `You are a loop guard for an autonomous agent-to-agent coding session.

Your job is to decide whether the agents are making meaningful progress or whether the conversation appears to be stuck in an unproductive loop.

Look for:
- Repeated delegation without progress
- Repeated summaries with no new action
- Circular requests (A asks B, B asks A, repeat)
- Agents asking each other to do the same thing
- Repeated failure messages
- No code, design, or testing progress
- Unclear ownership of the next step

Session name: ${sessionName}
Participating agents: ${agentNames}
Messages since last human intervention: ${loopState.consecutiveA2aCount}

Last ${recentMessages.length} agent-to-agent messages:
${messageLines}

If the session should be paused for human review, output exactly:
STOP

If the session is making meaningful progress and may continue, output exactly:
CONTINUE

Do not output anything else.`;
  }

  private callModel(prompt: string): Promise<string> {
    if (!this.config) return Promise.reject(new Error('No guard config'));

    const timeoutMs = this.config.timeoutMs || 10000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Guard model timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const data = JSON.stringify({
        model: this.config!.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }],
      });

      const url = new URL(this.config!.apiUrl || 'https://api.anthropic.com/v1/messages');

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config!.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const json = JSON.parse(body);
            if (json.error) {
              reject(new Error(`API error: ${json.error.message || JSON.stringify(json.error)}`));
              return;
            }
            const text = json.content?.[0]?.text || '';
            resolve(text);
          } catch {
            reject(new Error(`Failed to parse guard response: ${body.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      req.write(data);
      req.end();
    });
  }
}
