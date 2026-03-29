import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import Table, { Column } from '../components/Table';
import Modal from '../components/Modal';
import type { User, UpdateUserPayload } from '../types';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function UserEditModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [timezone, setTimezone] = useState(user.timezone ?? 'UTC');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload: UpdateUserPayload = { isAdmin, timezone };
      await apiClient.patch<User>(`/users/${user.id}`, payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save user');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit User: ${user.firstName} ${user.lastName ?? ''}`}
      onClose={onClose}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Read-only info */}
        <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-gray-700/30 text-sm">
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Telegram ID</p>
            <p className="text-gray-200 font-mono">{user.telegramId}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Username</p>
            <p className="text-gray-200">{user.username ? `@${user.username}` : '—'}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Messages</p>
            <p className="text-gray-200">{user.messageCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Joined</p>
            <p className="text-gray-200">
              {new Date(user.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Admin toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="label mb-0">Admin Status</label>
            <p className="text-xs text-gray-500 mt-0.5">Admins can access the dashboard</p>
          </div>
          <button
            onClick={() => setIsAdmin((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
              isAdmin ? 'bg-indigo-600' : 'bg-gray-600'
            }`}
            role="switch"
            aria-checked={isAdmin}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                isAdmin ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Timezone */}
        <div>
          <label className="label" htmlFor="timezone">Timezone</label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="input"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { data: users, loading, error, refetch } = useApi<User[]>('/users');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-indigo-300">
            {u.firstName[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200">
              {u.firstName} {u.lastName ?? ''}
            </p>
            <p className="text-xs text-gray-500">{u.username ? `@${u.username}` : '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'telegramId',
      header: 'Telegram ID',
      render: (u) => (
        <span className="text-xs font-mono text-gray-400">{u.telegramId}</span>
      ),
    },
    {
      key: 'isAdmin',
      header: 'Admin',
      render: (u) => (
        <span
          className={`badge ${
            u.isAdmin
              ? 'bg-indigo-900/50 text-indigo-300 border border-indigo-700/40'
              : 'bg-gray-700/50 text-gray-400'
          }`}
        >
          {u.isAdmin ? '✓ Admin' : 'User'}
        </span>
      ),
    },
    {
      key: 'timezone',
      header: 'Timezone',
      render: (u) => <span className="text-gray-400 text-xs">{u.timezone}</span>,
    },
    {
      key: 'messageCount',
      header: 'Messages',
      render: (u) => (
        <span className="tabular-nums text-gray-300">{u.messageCount.toLocaleString()}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Joined',
      render: (u) => (
        <span className="text-gray-500 text-xs">
          {new Date(u.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  async function handleToggleAdmin(user: User) {
    setToggling(user.id);
    try {
      await apiClient.patch<User>(`/users/${user.id}`, { isAdmin: !user.isAdmin });
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update user');
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title mb-0">Users</h1>
        <span className="text-sm text-gray-500">
          {users ? `${users.length} users` : ''}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
          {error}
        </div>
      )}

      <Table
        columns={columns}
        rows={users ?? []}
        keyExtractor={(u) => u.id}
        loading={loading}
        onRowClick={(u) => setEditUser(u)}
        emptyMessage="No users found"
        actions={(u) => (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => handleToggleAdmin(u)}
              disabled={toggling === u.id}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-50"
            >
              {toggling === u.id ? '...' : u.isAdmin ? 'Remove Admin' : 'Make Admin'}
            </button>
            <button
              onClick={() => setEditUser(u)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-700/40 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-600/30 transition-colors"
            >
              Edit
            </button>
          </div>
        )}
      />

      {editUser && (
        <UserEditModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
