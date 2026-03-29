import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import Modal from '../components/Modal';
import type { Skill } from '../types';

const SKILL_ICONS: Record<string, string> = {
  web_search: '🔍',
  weather: '🌤',
  calculator: '🧮',
  reminder: '🔔',
  todo: '✅',
  memory: '🧠',
  code: '💻',
  translate: '🌐',
  news: '📰',
  default: '⚡',
};

function getSkillIcon(name: string): string {
  return SKILL_ICONS[name] ?? SKILL_ICONS.default;
}

interface ConfigEditorProps {
  skill: Skill;
  onClose: () => void;
  onSaved: () => void;
}

function ConfigEditor({ skill, onClose, onSaved }: ConfigEditorProps) {
  const [configText, setConfigText] = useState(
    JSON.stringify(skill.config, null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(configText) as Record<string, unknown>;
      } catch {
        setError('Invalid JSON. Please fix the syntax and try again.');
        setSaving(false);
        return;
      }
      await apiClient.patch(`/skills/${skill.id}`, { config: parsed });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Configure: ${skill.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
            {error}
          </div>
        )}
        <p className="text-sm text-gray-400">{skill.description}</p>
        <div>
          <label className="label">Configuration (JSON)</label>
          <textarea
            className="input font-mono text-xs min-h-[240px] resize-y"
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>
    </Modal>
  );
}

export default function Skills() {
  const { data: skills, loading, error, refetch } = useApi<Skill[]>('/skills');
  const [configSkill, setConfigSkill] = useState<Skill | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  async function handleToggle(skill: Skill) {
    setToggling(skill.id);
    try {
      await apiClient.patch(`/skills/${skill.id}`, { isEnabled: !skill.isEnabled });
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update skill');
    } finally {
      setToggling(null);
    }
  }

  const enabledCount = skills?.filter((s) => s.isEnabled).length ?? 0;

  return (
    <div className="animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title mb-1">Skills</h1>
          {skills && (
            <p className="text-sm text-gray-500">
              {enabledCount} of {skills.length} enabled
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !skills || skills.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <div className="text-3xl mb-3">⚡</div>
          <p>No skills configured</p>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`card p-4 flex items-center gap-4 transition-all duration-200 ${
                skill.isEnabled ? '' : 'opacity-60'
              }`}
            >
              {/* Icon */}
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 border ${
                  skill.isEnabled
                    ? 'bg-indigo-600/20 border-indigo-500/30'
                    : 'bg-gray-700/30 border-gray-700/40'
                }`}
              >
                {getSkillIcon(skill.name)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-gray-200 capitalize">
                    {skill.name.replace(/_/g, ' ')}
                  </p>
                  {skill.isEnabled && (
                    <span className="badge bg-green-900/30 text-green-400 border border-green-700/30 text-xs">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{skill.description}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {skill.config && Object.keys(skill.config).length > 0 && (
                  <button
                    onClick={() => setConfigSkill(skill)}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                  >
                    Config
                  </button>
                )}
                {/* Toggle */}
                <button
                  onClick={() => handleToggle(skill)}
                  disabled={toggling === skill.id}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                    skill.isEnabled ? 'bg-indigo-600' : 'bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={skill.isEnabled}
                  title={skill.isEnabled ? 'Disable skill' : 'Enable skill'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                      skill.isEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {configSkill && (
        <ConfigEditor
          skill={configSkill}
          onClose={() => setConfigSkill(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
