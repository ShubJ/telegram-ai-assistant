/**
 * Research Agent — searches the web for best practices and technical info.
 */

import { config } from '../../config.js';
import { createLogger } from '../../logger.js';
import { BaseAgent } from '../base-agent.js';
import { AgentRole } from '../types.js';
import type { AgentToolDefinition } from '../types.js';
import type { MessageBus } from '../message-bus.js';
import type { WorkspaceManager } from '../workspace-manager.js';

const logger = createLogger('ResearcherAgent');

export class ResearcherAgent extends BaseAgent {
  constructor(instanceId: string, messageBus: MessageBus, workspaceManager: WorkspaceManager) {
    super(AgentRole.RESEARCHER, instanceId, messageBus, workspaceManager);
  }

  getSystemPrompt(): string {
    return `You are a senior technical researcher embedded in an autonomous software engineering team.

Your role is to gather information that will help the PM and EM make informed decisions about a new project or task.

When given a project description:
1. Identify the key technical areas that need research
2. Use web_search to find best practices, popular libraries, architectural patterns
3. Use web_read to get details from promising results
4. Synthesise your findings into a structured research report

Your output should be a well-organised report with:
- **Technology Recommendations**: Best frameworks, libraries, and tools for the task
- **Architectural Patterns**: Recommended approaches and design patterns
- **Best Practices**: Industry standards and conventions
- **Potential Risks**: Common pitfalls and how to avoid them
- **Reference Links**: URLs to key documentation

Be thorough but concise. Focus on actionable information that will help the team build a high-quality solution.`;
  }

  getTools(): AgentToolDefinition[] {
    return [
      {
        name: 'web_search',
        description: 'Search the web for technical information, best practices, and documentation.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
          },
          required: ['query'],
        },
      },
      {
        name: 'web_read',
        description: 'Fetch and read the content of a web page.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch' },
          },
          required: ['url'],
        },
      },
    ];
  }

  protected override async executeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<string> {
    switch (toolName) {
      case 'web_search':
        return this.webSearch(String(toolInput.query ?? ''));
      case 'web_read':
        return this.webRead(String(toolInput.url ?? ''));
      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  private async webSearch(query: string): Promise<string> {
    const apiKey = config.braveSearchApiKey;
    if (!apiKey) {
      return 'Web search is not available (no BRAVE_SEARCH_API_KEY configured).';
    }

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
      const response = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      });

      if (!response.ok) {
        return `Search failed with status ${response.status}`;
      }

      const data = (await response.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
      const results = data.web?.results ?? [];

      if (results.length === 0) return 'No results found.';

      return results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
        .join('\n\n');
    } catch (err) {
      logger.error('Web search failed', { error: err instanceof Error ? err.message : String(err) });
      return `Search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async webRead(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'TelegramAIAssistant/1.0' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return `Failed to fetch ${url}: status ${response.status}`;
      }

      const text = await response.text();
      // Strip HTML tags for a rough text extraction
      const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Truncate to avoid blowing up context
      return cleaned.slice(0, 5000);
    } catch (err) {
      logger.error('Web read failed', { url, error: err instanceof Error ? err.message : String(err) });
      return `Fetch error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
