import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import type { Reminder, User } from '../types';

function formatDateTime(str: string): string {
  try {
    return new Date(str).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return str;
  }
}

function isOverdue(scheduledAt: string, isActive: boolean): boolean {
  return isActive && new Date(scheduledAt) < new Date();
}

export default function Reminders() {
  const [filterUserId, setFilterUserId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'sent'>('all');
  const [toggling, setToggling] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  if (filterUserId) queryParams.set('userId', filterUserId);
  if (filterStatus === 'active') queryParams.set('active', 'true');
  if (filterStatus === 'inactive') queryParams.set('active', 'false');
  if (filterStatus === 'sent') queryParams.set('sent', 'true');

  const { data: reminders, loading, error, refetch } = useApi<Reminder[]>(
    `/reminders?${queryParams.toString()}`,
    { deps: [filterUserId, filterStatus] },
  );
  const { data: users } = useApi<User[]>('/users');

  async function handleToggle(reminder: Reminder) {
    setToggling(reminder.id);
    try {
      await apiClient.patch(`/reminders/${reminder.id}`, { isActive: !reminder.isActive });
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update reminder');
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this reminder?')) return;
    setDeleting(id);
    try {
      await apiClient.delete(`/reminders/${id}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete reminder');
    } finally {
      setDeleting(null);
    }
  }

  const activeCount = reminders?.filter((r) => r.isActive && !r.isSent).length ?? 0;
  const overdueCount = reminders?.filter((r) => isOverdue(r.scheduledAt, r.isActive)).length ?? 0;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title mb-1">Reminders</h1>
          {reminders && (
            <p className="text-sm text-gray-500">
              {activeCount} active
              {overdueCount > 0 && (
                <span className="text-red-400 ml-2">· {overdueCount} overdue</span>
              )}
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

        <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
          {(['all', 'active', 'inactive', 'sent'] as const).map((status) => (
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

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !reminders || reminders.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <div className="text-3xl mb-3">🔔</div>
          <p>No reminders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reminders.map((reminder) => {
            const overdue = isOverdue(reminder.scheduledAt, reminder.isActive);
            return (
              <div
                key={reminder.id}
                className={`card p-4 flex items-start gap-4 ${
                  reminder.isSent ? 'opacity-50' : ''
                }`}
              >
                {/* Bell icon */}
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 border ${
                    reminder.isSent
                      ? 'bg-gray-700/30 border-gray-700'
                      : overdue
                      ? 'bg-red-900/30 border-red-700/30'
                      : reminder.isActive
                      ? 'bg-indigo-600/20 border-indigo-500/30'
                      : 'bg-gray-700/30 border-gray-700'
                  }`}
                >
                  {reminder.isSent ? '✓' : overdue ? '⚠️' : '🔔'}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 leading-relaxed mb-2">
                    {reminder.content}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status badge */}
                    {reminder.isSent ? (
                      <span className="badge bg-gray-700/40 text-gray-500 text-xs">
                        Sent {reminder.sentAt ? formatDateTime(reminder.sentAt) : ''}
                      </span>
                    ) : overdue ? (
                      <span className="badge bg-red-900/30 text-red-400 border border-red-700/30 text-xs">
                        Overdue
                      </span>
                    ) : reminder.isActive ? (
                      <span className="badge bg-green-900/30 text-green-400 border border-green-700/30 text-xs">
                        Active
                      </span>
                    ) : (
                      <span className="badge bg-gray-700/40 text-gray-400 text-xs">
                        Inactive
                      </span>
                    )}

                    <span className="text-xs text-gray-500">
                      📅 {formatDateTime(reminder.scheduledAt)}
                    </span>

                    {reminder.recurrence && (
                      <span className="badge bg-purple-900/30 text-purple-300 border border-purple-700/30 text-xs">
                        🔁 {reminder.recurrence}
                      </span>
                    )}

                    {reminder.firstName && (
                      <span className="text-xs text-gray-500">
                        {reminder.firstName}
                        {reminder.username ? ` (@${reminder.username})` : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!reminder.isSent && (
                    <button
                      onClick={() => handleToggle(reminder)}
                      disabled={toggling === reminder.id}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                        reminder.isActive ? 'bg-indigo-600' : 'bg-gray-600'
                      }`}
                      role="switch"
                      aria-checked={reminder.isActive}
                      title={reminder.isActive ? 'Deactivate' : 'Activate'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                          reminder.isActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(reminder.id)}
                    disabled={deleting === reminder.id}
                    className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    {deleting === reminder.id ? '...' : '🗑'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
