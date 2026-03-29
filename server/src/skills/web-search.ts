/**
 * WebSearchSkill — searches the web using the Brave Search API.
 *
 * If BRAVE_SEARCH_API_KEY is not configured the skill returns a friendly
 * "not configured" message instead of throwing.
 */

import { BaseSkill, type SkillResult } from './base.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { ExternalServiceError } from '../errors.js';

const logger = createLogger('WebSearchSkill');

// ---------------------------------------------------------------------------
// Brave Search API types (subset we actually use)
// ---------------------------------------------------------------------------

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

// ---------------------------------------------------------------------------
// Skill implementation
// ---------------------------------------------------------------------------

export class WebSearchSkill extends BaseSkill {
  readonly name = 'web-search';
  readonly description = 'Search the web for up-to-date information using Brave Search.';

  getToolDefinition() {
    return {
      name: 'web_search',
      description:
        'Search the web for up-to-date information. Use this when the user asks about current events, recent news, or anything you don\'t have knowledge about.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web.',
          },
        },
        required: ['query'],
      },
    };
  }

  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.search.brave.com/res/v1/web/search';

  constructor() {
    super();
    this.apiKey = config.braveSearchApiKey;
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const query = typeof params['query'] === 'string' ? params['query'].trim() : '';

    if (!query) {
      return this.failure('Please provide a search query. Usage: /search <query>');
    }

    if (!this.apiKey) {
      return this.failure(
        'Web search is not configured. Ask the bot administrator to add a BRAVE_SEARCH_API_KEY.',
      );
    }

    try {
      const results = await this.fetchResults(query);

      if (results.length === 0) {
        return this.success(`No results found for "${query}".`);
      }

      const formatted = this.formatResults(query, results);
      return this.success(formatted, { results });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Error fetching results', { query, error: message });
      if (err instanceof Error && !(err instanceof ExternalServiceError)) {
        throw new ExternalServiceError('BraveSearch', message, err);
      }
      return this.failure(`Search failed: ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchResults(query: string): Promise<BraveWebResult[]> {
    const url = new URL(this.apiUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    url.searchParams.set('search_lang', 'en');
    url.searchParams.set('safesearch', 'moderate');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Brave Search API returned ${response.status}: ${body}`);
    }

    const data = (await response.json()) as BraveSearchResponse;
    return data.web?.results ?? [];
  }

  private formatResults(query: string, results: BraveWebResult[]): string {
    const lines: string[] = [`*Search results for:* ${this.escapeMarkdown(query)}`, ''];

    results.slice(0, 5).forEach((result, index) => {
      const title = this.escapeMarkdown(result.title);
      const url = result.url;
      const snippet = result.description
        ? this.escapeMarkdown(result.description.slice(0, 200))
        : '_No description available_';

      lines.push(`*${index + 1}.* [${title}](${url})`);
      lines.push(snippet);
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  /** Escape special Telegram MarkdownV2 characters. */
  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
  }
}
