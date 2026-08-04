import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { OpenAiCompatProvider, resolveOpenAiApiKey } from '../config';
import { StreamEmitter } from '../protocol';
import { SessionStore } from '../sessionStore';

/**
 * OpenAI-compatible chat backend (Ollama, LM Studio, llama.cpp llama-server,
 * vLLM, or any hosted endpoint speaking /v1/chat/completions).
 *
 * The server is stateless, so the bridge owns the conversation history and
 * replays it on every turn (persisted per ClaUi session in the SessionStore).
 * Responses stream via SSE and are forwarded as text deltas.
 */
export class OpenAiCompatBackend {
  private aborter: AbortController | null = null;

  constructor(
    private readonly provider: OpenAiCompatProvider,
    private readonly model: string,
    private readonly sessionId: string,
    private readonly store: SessionStore,
    private readonly systemPrompt: string,
  ) {}

  interrupt(): void {
    this.aborter?.abort();
  }

  async runTurn(prompt: string, emitter: StreamEmitter): Promise<string> {
    const state = this.store.read(this.sessionId);
    const history = state?.history || [];
    const messages: { role: string; content: string }[] = [];
    if (this.systemPrompt) {
      messages.push({ role: 'system', content: this.systemPrompt });
    }
    for (const turn of history) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: prompt });

    const text = await this.streamChatCompletion(messages, (delta) =>
      emitter.append('text', delta),
    );

    this.store.write(this.sessionId, { backend: 'openai', model: this.model });
    this.store.appendHistory(this.sessionId, 'user', prompt);
    this.store.appendHistory(this.sessionId, 'assistant', text);
    return text;
  }

  private streamChatCompletion(
    messages: { role: string; content: string }[],
    onDelta: (text: string) => void,
  ): Promise<string> {
    const endpoint = new URL(
      this.provider.baseUrl.replace(/\/+$/, '') + '/chat/completions',
    );
    const body = JSON.stringify({
      model: this.model,
      messages,
      stream: true,
    });
    const apiKey = resolveOpenAiApiKey(this.provider);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      Accept: 'text/event-stream',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    this.aborter = new AbortController();
    const transport = endpoint.protocol === 'https:' ? https : http;

    return new Promise<string>((resolve, reject) => {
      const req = transport.request(
        endpoint,
        { method: 'POST', headers, signal: this.aborter!.signal },
        (res) => {
          if (!res.statusCode || res.statusCode >= 400) {
            let errBody = '';
            res.on('data', (d) => {
              errBody += String(d);
            });
            res.on('end', () =>
              reject(
                new Error(
                  `${endpoint.host} returned HTTP ${res.statusCode}: ${errBody.slice(0, 500)}`,
                ),
              ),
            );
            return;
          }

          let full = '';
          let buffer = '';
          let sawDone = false;

          const handleDataLine = (payload: string) => {
            if (payload === '[DONE]') {
              sawDone = true;
              return;
            }
            try {
              const parsed = JSON.parse(payload) as {
                choices?: { delta?: { content?: string }; message?: { content?: string } }[];
              };
              const choice = parsed.choices?.[0];
              const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
              if (delta) {
                full += delta;
                onDelta(delta);
              }
            } catch {
              /* ignore malformed SSE payloads */
            }
          };

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).replace(/\r$/, '');
              buffer = buffer.slice(nl + 1);
              if (line.startsWith('data:')) {
                handleDataLine(line.slice(5).trim());
              } else if (line.trim() && !full && !sawDone && line.trim().startsWith('{')) {
                // Non-streaming server that ignored stream:true — parse whole body.
                handleDataLine(line.trim());
              }
            }
          });
          res.on('end', () => resolve(full));
          res.on('error', (e) => reject(e));
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) => {
        if (e.name === 'AbortError') {
          reject(new Error('Request interrupted'));
        } else if (e.code === 'ECONNREFUSED') {
          reject(
            new Error(
              `Cannot reach ${endpoint.host} — is the server running? (${this.provider.baseUrl})`,
            ),
          );
        } else {
          reject(e);
        }
      });
      req.write(body);
      req.end();
    });
  }
}
