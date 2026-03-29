import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import Modal from '../components/Modal';
import type { Memory, CreateMemoryPayload, MemoryType, MemoryImportance, User } from '../types';

const IMPORTANCE_COLORS: Record<number, string> = {
  1: 'bg-gray-700/60 text-gray-400',
  2: 'bg-blue-900/40 text-blue-400 border border-blue-700/30',
  3: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/30',
  4: 'bg-orange-900/30 text-orange-400 border border-orange-700/30',
  5: 'bg-red-900/30 text-red-400 border border-red-700/30',
};

const IMPORTANCE_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Normal',
  3: 'Medium',
  4: 'High',
  5: 'Critical',
};

const TYPE_COLORS: Record<string, string> = {
  fact: 'bg-indigo-900/30 text-indigo-300 border border-indigo-700/30',
  preference: 'bg-purple-900/30 text-purple-300 border border-purple-700/30',
  event: 'bg-teal-900/30 text-teal-300 border border-teal-700/30',
  general: 'bg-gray-700/40 text-gray-400',
};

interface MemoryCardProps {
  memory: Memory;
  onEdit: (m: Memory) => void;
  onDelete: (id: number) => void;
  deleting: boolean;
}

function MemoryCard({ memory, onEdit, onDelete, deleting }: MemoryCardProps) {
  return (
    <div className="card p-4 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${IMPORTANCE_COLORS[memory.importance]}`}>
            {'★'.repeat(memory.importance)} {IMPORTANCE_LABELS[memory.importance]}
          </span>
          <span className={`badge ${TYPE_COLORS[memory.type]}`}>
            {memory.type}
          </span>
          {memory.username && (
            <span className="badge bg-gray-700/40 text-gray-400">
              @{memory.username}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => onEdit(memory)}
            className="text-xs px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            disabled={deleting}
            className="text-xs px-2 py-1 rounded-md bg-red-900/30 hover:bg-red-800/40 text-red-400 border border-red-700/30 transition-colors disabled:opacity-50"
          >
            {deleting ? '...' : 'Delete'}
          </button>
        </div>
      </div>

      <p className="text-gray-200 text-sm leading-relaxed">{memory.content}</p>

      <p className="text-xs text-gray-500">
        {new Date(memory.createdAt).toLocaleDateString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </p>
    </div>
  );
}

interface EditModalProps {
  memory: Memory;
  onClose: () => void;
  onSaved: () => void;
}

function EditMemoryModal({ memory, onClose, onSaved }: EditModalProps) {
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<MemoryType>(memory.type);
  const [importance, setImportance] = useState<MemoryImportance>(memory.importance);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!content.trim()) { setError('Content is required'); return; }
    setSaving(true);
    setError('');
    try {
      await apiClient.patch(`/memories/${memory.id}`, { content, type, importance });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Edit Memory"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save'}
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
        <div>
          <label className="label">Content</label>
          <textarea
            className="input min-h-[100px] resize-y"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
              <option value="fact">Fact</option>
              <option value="preference">Preference</option>
              <option value="event">Event</option>
              <option value="general">General</option>
            </select>
          </div>
          <div>
            <label className="label">Importance</label>
            <select
              className="input"
              value={importance}
              onChange={(e) => setImportance(parseInt(e.target.value) as MemoryImportance)}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface AddMemoryModalProps {
  users: User[];
  onClose: () => void;
  onSaved: () => void;
}

function AddMemoryModal({ users, onClose, onSaved }: AddMemoryModalProps) {
  const [userId, setUserId] = useState(users[0]?.id ? String(users[0].id) : '');
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('general');
  const [importance, setImportance] = useState<MemoryImportance>(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!content.trim()) { setError('Content is required'); return; }
    if (!userId) { setError('Please select a user'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: CreateMemoryPayload = {
        userId: parseInt(userId),
        content,
        type,
        importance,
      };
      await apiClient.post('/memories', payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create memory');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add Memory"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Add Memory'}
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
        <div>
          <label className="label">User</label>
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select a user...</option>
            {users.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.firstName} {u.lastName ?? ''} {u.username ? `(@${u.username})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Content</label>
          <textarea
            className="input min-h-[100px] resize-y"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter memory content..."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
              <option value="fact">Fact</option>
              <option value="preference">Preference</option>
              <option value="event">Event</option>
              <option value="general">General</option>
            </select>
          </div>
          <div>
            <label className="label">Importance</label>
            <select
              className="input"
              value={importance}
              onChange={(e) => setImportance(parseInt(e.target.value) as MemoryImportance)}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <option key={i} value={i}>{IMPORTANCE_LABELS[i]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function Memories() {
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterImportance, setFilterImportance] = useState('');
  const [editMemory, setEditMemory] = useState<Memory | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  if (filterUserId) queryParams.set('userId', filterUserId);
  if (filterType) queryParams.set('type', filterType);
  if (filterImportance) queryParams.set('importance', filterImportance);

  const { data: memories, loading, error, refetch } = useApi<Memory[]>(
    `/memories?${queryParams.toString()}`,
    { deps: [filterUserId, filterType, filterImportance] },
  );
  const { data: users } = useApi<User[]>('/users');

  async function handleDelete(id: number) {
    if (!confirm('Delete this memory?')) return;
    setDeleting(id);
    try {
      await apiClient.delete(`/memories/${id}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title mb-0">Memories</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          + Add Memory
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          className="input w-auto min-w-[160px]"
          value={filterUserId}
          onChange={(e) => setFilterUserId(e.target.value)}
        >
          <option value="">All users</option>
          {users?.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.firstName} {u.lastName ?? ''}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="fact">Fact</option>
          <option value="preference">Preference</option>
          <option value="event">Event</option>
          <option value="general">General</option>
        </select>
        <select
          className="input w-auto"
          value={filterImportance}
          onChange={(e) => setFilterImportance(e.target.value)}
        >
          <option value="">All importance</option>
          {[1, 2, 3, 4, 5].map((i) => (
            <option key={i} value={String(i)}>{IMPORTANCE_LABELS[i]}</option>
          ))}
        </select>
        {(filterUserId || filterType || filterImportance) && (
          <button
            onClick={() => { setFilterUserId(''); setFilterType(''); setFilterImportance(''); }}
            className="btn-secondary text-xs px-3"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !memories || memories.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <div className="text-3xl mb-3">🧠</div>
          <p>No memories found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memories.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              onEdit={setEditMemory}
              onDelete={handleDelete}
              deleting={deleting === m.id}
            />
          ))}
        </div>
      )}

      {editMemory && (
        <EditMemoryModal
          memory={editMemory}
          onClose={() => setEditMemory(null)}
          onSaved={refetch}
        />
      )}

      {showAdd && (
        <AddMemoryModal
          users={users ?? []}
          onClose={() => setShowAdd(false)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
