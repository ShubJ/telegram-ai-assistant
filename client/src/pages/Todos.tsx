import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import type { Todo, User, TodoPriority } from '../types';

const PRIORITY_STYLES: Record<TodoPriority, string> = {
  low: 'bg-gray-700/40 text-gray-400',
  medium: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/30',
  high: 'bg-red-900/30 text-red-400 border border-red-700/30',
};

const PRIORITY_ICONS: Record<TodoPriority, string> = {
  low: '▽',
  medium: '◇',
  high: '▲',
};

function formatDate(str: string | null): string {
  if (!str) return '—';
  return new Date(str).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Todos() {
  const [filterUserId, setFilterUserId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [toggling, setToggling] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  if (filterUserId) queryParams.set('userId', filterUserId);
  if (filterStatus === 'active') queryParams.set('completed', 'false');
  if (filterStatus === 'completed') queryParams.set('completed', 'true');

  const { data: todos, loading, error, refetch } = useApi<Todo[]>(
    `/todos?${queryParams.toString()}`,
    { deps: [filterUserId, filterStatus] },
  );
  const { data: users } = useApi<User[]>('/users');

  async function handleToggle(todo: Todo) {
    setToggling(todo.id);
    try {
      await apiClient.patch(`/todos/${todo.id}`, { isCompleted: !todo.isCompleted });
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update todo');
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this todo?')) return;
    setDeleting(id);
    try {
      await apiClient.delete(`/todos/${id}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete todo');
    } finally {
      setDeleting(null);
    }
  }

  const completedCount = todos?.filter((t) => t.isCompleted).length ?? 0;
  const totalCount = todos?.length ?? 0;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title mb-1">Todos</h1>
          {todos && (
            <p className="text-sm text-gray-500">
              {completedCount} of {totalCount} completed
            </p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
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

        {/* Status tabs */}
        <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
          {(['all', 'active', 'completed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                filterStatus === status
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mb-5">
          <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((completedCount / totalCount) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !todos || todos.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <div className="text-3xl mb-3">✅</div>
          <p>No todos found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className={`card p-4 flex items-start gap-3 transition-opacity duration-200 ${
                todo.isCompleted ? 'opacity-60' : ''
              }`}
            >
              {/* Checkbox */}
              <button
                onClick={() => handleToggle(todo)}
                disabled={toggling === todo.id}
                className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  todo.isCompleted
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-gray-500 hover:border-indigo-500'
                } disabled:opacity-50`}
              >
                {todo.isCompleted && <span className="text-xs leading-none">✓</span>}
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm text-gray-200 leading-relaxed ${todo.isCompleted ? 'line-through text-gray-500' : ''}`}>
                  {todo.content}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`badge text-xs ${PRIORITY_STYLES[todo.priority]}`}>
                    {PRIORITY_ICONS[todo.priority]} {todo.priority}
                  </span>
                  {todo.firstName && (
                    <span className="text-xs text-gray-500">
                      {todo.firstName} {todo.username ? `(@${todo.username})` : ''}
                    </span>
                  )}
                  {todo.dueDate && (
                    <span className="text-xs text-gray-500">
                      Due: {formatDate(todo.dueDate)}
                    </span>
                  )}
                  {todo.isCompleted && todo.completedAt && (
                    <span className="text-xs text-green-500/70">
                      ✓ {formatDate(todo.completedAt)}
                    </span>
                  )}
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={() => handleDelete(todo.id)}
                disabled={deleting === todo.id}
                className="flex-shrink-0 text-xs px-2 py-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {deleting === todo.id ? '...' : '🗑'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
