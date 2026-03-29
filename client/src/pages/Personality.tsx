import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import type { PersonalityConfig, UpdatePersonalityPayload } from '../types';

const DEFAULT_TRAITS = ['helpful', 'friendly', 'concise', 'knowledgeable'];

export default function Personality() {
  const { data: config, loading, error, refetch } = useApi<PersonalityConfig>('/personality');

  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [traitsInput, setTraitsInput] = useState('');
  const [tone, setTone] = useState('');
  const [responseStyle, setResponseStyle] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (config) {
      setName(config.name);
      setSystemPrompt(config.systemPrompt);
      setTraitsInput(config.traits.join(', '));
      setTone(config.tone);
      setResponseStyle(config.responseStyle);
      setCustomInstructions(config.customInstructions ?? '');
    }
  }, [config]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const traits = traitsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const payload: UpdatePersonalityPayload = {
        name,
        systemPrompt,
        traits,
        tone,
        responseStyle,
        customInstructions: customInstructions || undefined,
      };
      await apiClient.put('/personality', payload);
      setSaveSuccess(true);
      refetch();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save personality');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!confirm('Reset personality to default? This will overwrite your current settings.')) return;
    setName('Atlas');
    setSystemPrompt(
      `You are Atlas, a helpful AI assistant. You have a friendly, knowledgeable personality and strive to be genuinely useful to the people you help. You communicate clearly and concisely, adapting your style to suit the conversation.`,
    );
    setTraitsInput(DEFAULT_TRAITS.join(', '));
    setTone('friendly');
    setResponseStyle('concise');
    setCustomInstructions('');
  }

  const previewPrompt = systemPrompt.replace('{name}', name);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title mb-0">Personality</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowPreview((v) => !v)} className="btn-secondary text-xs">
            {showPreview ? 'Hide Preview' : 'Show Preview'}
          </button>
          <button onClick={handleReset} className="btn-secondary">
            Reset to Default
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {saveError && (
          <div className="p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="p-4 rounded-xl bg-green-900/20 border border-green-700/40 text-green-300 text-sm">
            ✓ Personality saved successfully
          </div>
        )}

        <div className="card p-5 space-y-5">
          <h2 className="section-header mb-0">Basic Info</h2>

          <div>
            <label className="label" htmlFor="bot-name">Bot Name</label>
            <input
              id="bot-name"
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Atlas"
              required
            />
            <p className="text-xs text-gray-500 mt-1.5">The name your assistant uses to identify itself</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="tone">Tone</label>
              <select
                id="tone"
                className="input"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="formal">Formal</option>
                <option value="playful">Playful</option>
                <option value="empathetic">Empathetic</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="response-style">Response Style</label>
              <select
                id="response-style"
                className="input"
                value={responseStyle}
                onChange={(e) => setResponseStyle(e.target.value)}
              >
                <option value="concise">Concise</option>
                <option value="detailed">Detailed</option>
                <option value="balanced">Balanced</option>
                <option value="conversational">Conversational</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="traits">
              Personality Traits
              <span className="text-gray-500 font-normal ml-1.5">(comma-separated)</span>
            </label>
            <input
              id="traits"
              type="text"
              className="input"
              value={traitsInput}
              onChange={(e) => setTraitsInput(e.target.value)}
              placeholder="helpful, friendly, concise..."
            />
            {/* Trait chips */}
            {traitsInput && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {traitsInput.split(',').map((t, i) => {
                  const trait = t.trim();
                  if (!trait) return null;
                  return (
                    <span key={i} className="badge bg-indigo-900/30 text-indigo-300 border border-indigo-700/30">
                      {trait}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="section-header mb-0">System Prompt</h2>
          <p className="text-xs text-gray-500 -mt-2">
            This is the core instruction sent to the AI at the start of every conversation.
          </p>
          <textarea
            className="input min-h-[160px] resize-y font-mono text-xs leading-relaxed"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant..."
            required
          />
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="section-header mb-0">Custom Instructions</h2>
          <p className="text-xs text-gray-500 -mt-2">
            Additional instructions appended to the system prompt (optional).
          </p>
          <textarea
            className="input min-h-[80px] resize-y"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Additional instructions..."
          />
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="card p-5 space-y-3">
            <h2 className="section-header mb-0">System Prompt Preview</h2>
            <div className="p-4 rounded-xl bg-gray-900 border border-gray-700/60 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
              {previewPrompt || <span className="text-gray-600 italic">No system prompt set</span>}
            </div>
            {customInstructions && (
              <>
                <p className="text-xs text-gray-500 font-medium">Additional Instructions:</p>
                <div className="p-4 rounded-xl bg-gray-900 border border-gray-700/60 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {customInstructions}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={handleReset} className="btn-secondary">
            Reset
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Personality'}
          </button>
        </div>
      </form>
    </div>
  );
}
