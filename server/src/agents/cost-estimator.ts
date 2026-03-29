/**
 * Cost estimator — classifies task complexity and estimates budget.
 *
 * Uses a quick LLM call to classify complexity, then applies pricing
 * tables to produce a cost estimate.
 */

import { getLLMManager } from '../llm/index.js';
import { createLogger } from '../logger.js';
import type { CostEstimate, TaskComplexity } from './types.js';

const logger = createLogger('CostEstimator');

// ---------------------------------------------------------------------------
// Pricing tables (per-call averages)
// ---------------------------------------------------------------------------

const PRICING: Record<string, { inputPer1k: number; outputPer1k: number; avgInputTokens: number; avgOutputTokens: number }> = {
  'claude-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125, avgInputTokens: 2000, avgOutputTokens: 1000 },
  'claude-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015, avgInputTokens: 3000, avgOutputTokens: 2000 },
  'claude-opus': { inputPer1k: 0.015, outputPer1k: 0.075, avgInputTokens: 3000, avgOutputTokens: 2000 },
};

const COMPLEXITY_CALLS: Record<TaskComplexity, number> = {
  small: 12,
  medium: 20,
  large: 35,
  xl: 50,
};

const PHASE_DISTRIBUTION: Record<string, number> = {
  research: 0.05,
  planning: 0.10,
  design: 0.10,
  taskSplit: 0.05,
  coding: 0.35,
  review: 0.15,
  testing: 0.10,
  audit: 0.05,
  shipping: 0.05,
};

// ---------------------------------------------------------------------------
// CostEstimator
// ---------------------------------------------------------------------------

export class CostEstimator {
  /**
   * Estimate the cost of a task/project before execution.
   */
  async estimateCost(taskDescription: string, model?: string): Promise<CostEstimate> {
    const complexity = await this.classifyComplexity(taskDescription);
    const pricingKey = this.resolvePricingKey(model);
    const pricing = PRICING[pricingKey] ?? PRICING['claude-sonnet'];

    const totalCalls = COMPLEXITY_CALLS[complexity];
    const avgTokensPerCall = pricing.avgInputTokens + pricing.avgOutputTokens;
    const totalTokens = totalCalls * avgTokensPerCall;

    const costPerCall =
      (pricing.avgInputTokens / 1000) * pricing.inputPer1k +
      (pricing.avgOutputTokens / 1000) * pricing.outputPer1k;
    const totalCost = totalCalls * costPerCall;

    const breakdown: CostEstimate['breakdown'] = {};
    for (const [phase, ratio] of Object.entries(PHASE_DISTRIBUTION)) {
      const calls = Math.max(1, Math.round(totalCalls * ratio));
      breakdown[phase] = {
        calls,
        tokens: calls * avgTokensPerCall,
        cost: calls * costPerCall,
      };
    }

    return {
      taskComplexity: complexity,
      estimatedCalls: totalCalls,
      estimatedTokens: totalTokens,
      estimatedCost: Math.round(totalCost * 1000) / 1000,
      breakdown,
    };
  }

  /**
   * Format a cost estimate as a human-readable string for Telegram.
   */
  formatEstimate(estimate: CostEstimate): string {
    const lines = [
      `📊 *Cost Estimate*`,
      ``,
      `Complexity: *${estimate.taskComplexity.toUpperCase()}*`,
      `Estimated agent calls: ~${estimate.estimatedCalls}`,
      `Estimated tokens: ~${(estimate.estimatedTokens / 1000).toFixed(0)}K`,
      `Estimated cost: *$${estimate.estimatedCost.toFixed(3)}*`,
      ``,
      `_Breakdown:_`,
    ];

    for (const [phase, data] of Object.entries(estimate.breakdown)) {
      lines.push(`  ${phase}: ${data.calls} calls (~$${data.cost.toFixed(4)})`);
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async classifyComplexity(description: string): Promise<TaskComplexity> {
    try {
      const llm = getLLMManager();
      const response = await llm.generateResponse(
        [
          {
            role: 'user',
            content: `Classify the following software task into one of: small, medium, large, xl.

Reply with ONLY the classification word (small/medium/large/xl).

- small: single file, simple feature, bug fix (<100 lines)
- medium: 2-5 files, moderate feature (100-500 lines)
- large: 5-15 files, significant feature or small project (500-2000 lines)
- xl: 15+ files, full project or major system (2000+ lines)

Task: ${description}`,
          },
        ],
        'You are a task complexity classifier. Reply with exactly one word.',
        { maxTokens: 10, temperature: 0 },
      );

      const raw = response.content.trim().toLowerCase();
      if (raw === 'small' || raw === 'medium' || raw === 'large' || raw === 'xl') {
        return raw;
      }
      logger.warn('Unexpected complexity classification, defaulting to medium', { raw });
      return 'medium';
    } catch (err) {
      logger.error('Complexity classification failed, defaulting to medium', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 'medium';
    }
  }

  private resolvePricingKey(model?: string): string {
    if (!model) return 'claude-sonnet';
    const lower = model.toLowerCase();
    if (lower.includes('haiku')) return 'claude-haiku';
    if (lower.includes('opus')) return 'claude-opus';
    return 'claude-sonnet';
  }
}
