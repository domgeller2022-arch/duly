/**
 * The OpenAI-compatible AI adapter.
 *
 * Ollama, OpenRouter and any OpenAI-compatible endpoint speak the same
 * `/chat/completions` shape, so one adapter serves all of them and the
 * settings screen only carries the base URL and key. One retry and a timeout
 * live here, because a hanging local model is exactly as annoying as a slow
 * cloud one.
 */

import type { AiAdapter, AiCompletionRequest, AiCompletionResult } from '../types';

const DEFAULT_TIMEOUT = 30_000;

export class OpenAiCompatibleAdapter implements AiAdapter {
  readonly name = 'openai-compatible';

  async complete(request: AiCompletionRequest, baseUrl: string): Promise<AiCompletionResult> {
    const timeout = request.timeoutMs ?? DEFAULT_TIMEOUT;
    let lastError = '';

    // One retry: a local model can be mid-reload, and a single failed call
    // should not read as "AI is broken".
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: request.model || 'local',
            messages: [
              { role: 'system', content: request.system },
              ...(request.images?.length
                ? [
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: request.prompt },
                        ...request.images.map((image) => ({
                          type: 'image_url',
                          image_url: { url: `data:image/jpeg;base64,${image}` },
                        })),
                      ],
                    },
                  ]
                : [{ role: 'user', content: request.prompt }]),
            ],
            stream: false,
          }),
        });

        if (!response.ok) {
          lastError = `The endpoint returned ${response.status}.`;
          continue;
        }

        const payload = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { total_tokens?: number };
        };
        const content = payload.choices?.[0]?.message?.content ?? '';
        return {
          ok: true,
          content,
          tokens: payload.usage?.total_tokens ?? 0,
        };
      } catch (error) {
        lastError =
          error instanceof Error && error.name === 'AbortError'
            ? 'The request timed out.'
            : error instanceof Error
              ? error.message
              : 'The request failed.';
      } finally {
        clearTimeout(timer);
      }
    }

    return { ok: false, content: '', tokens: 0, error: lastError };
  }
}
