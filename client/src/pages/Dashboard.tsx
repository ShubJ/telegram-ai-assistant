import React from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import StatsCard from '../components/StatsCard';
import type { DashboardStats, ActivityDataPoint, Conversation } from '../types';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

function BarChart({ data }: { data: ActivityDataPoint[] }) {
  const max = Math.max(...data.map((d) => d.messageCount), 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-1.5 h-32">
        {data.map((point) => {
          const heightPct = (point.messageCount / max) * 100;
          return (
            <div
              key={point.date}
              className="flex-1 flex flex-col items-center justify-end gap-1 group relative"
            >
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                <span className="font-semibold">{point.messageCount}</span> msgs
                <br />
                <span className="text-gray-400">{point.date}</span>
              </div>
              <div
                className="w-full rounded-t-sm bg-indigo-600/70 hover:bg-indigo-500 transition-colors duration-150 min-h-[2px]"
                style={{ height: `${Math.max(heightPct, 2)}%` }}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis labels */}
      <div className="flex gap-1.5">
        {data.map((point) => (
          <div key={point.date} className="flex-1 text-center text-xs text-gray-600 truncate">
            {new Date(point.date).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, loading: statsLoading, error: statsError } = useApi<DashboardStats>('/stats');
  const { data: activity, loading: activityLoading } = useApi<ActivityDataPoint[]>('/stats/activity');
  const { data: recentConversations, loading: convsLoading } = useApi<Conversation[]>('/conversations?limit=5');

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title mb-0">Dashboard</h1>
        <span className="text-xs text-gray-500">
          {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {/* Stats Error */}
      {statsError && (
        <div className="mb-6 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
          Failed to load stats: {statsError}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        <StatsCard
          title="Total Users"
          value={statsLoading ? '—' : (stats?.totalUsers ?? 0)}
          icon="👥"
          subtitle="Registered users"
        />
        <StatsCard
          title="Total Messages"
          value={statsLoading ? '—' : (stats?.totalMessages ?? 0)}
          icon="💬"
          subtitle="All time"
        />
        <StatsCard
          title="Active Conversations"
          value={statsLoading ? '—' : (stats?.activeConversations ?? 0)}
          icon="🔥"
          subtitle="Open threads"
        />
        <StatsCard
          title="Memories"
          value={statsLoading ? '—' : (stats?.totalMemories ?? 0)}
          icon="🧠"
          subtitle="Stored facts"
        />
        <StatsCard
          title="Uptime"
          value={statsLoading ? '—' : formatUptime(stats?.uptimeSeconds ?? 0)}
          icon="⏱️"
          subtitle="Server uptime"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Activity Chart */}
        <div className="xl:col-span-3 card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="section-header mb-0">Message Activity</h2>
            <span className="text-xs text-gray-500">Last 14 days</span>
          </div>
          {activityLoading ? (
            <div className="h-40 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : activity && activity.length > 0 ? (
            <BarChart data={activity} />
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
              No activity data available
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          <div className="card p-5">
            <h2 className="section-header mb-4">Todo Progress</h2>
            {statsLoading ? (
              <div className="h-12 bg-gray-700/40 rounded-lg animate-pulse" />
            ) : (
              <>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">
                    {stats?.todosCompleted ?? 0} of {stats?.todosTotal ?? 0} completed
                  </span>
                  <span className="text-indigo-400 font-medium">
                    {stats?.todosTotal
                      ? Math.round(((stats.todosCompleted) / stats.todosTotal) * 100)
                      : 0}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                    style={{
                      width: `${stats?.todosTotal ? Math.round((stats.todosCompleted / stats.todosTotal) * 100) : 0}%`,
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="card p-5">
            <h2 className="section-header mb-3">Active Reminders</h2>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-white">
                {statsLoading ? '—' : (stats?.remindersActive ?? 0)}
              </span>
              <span className="text-sm text-gray-500">pending reminders</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="mt-6 card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/60">
          <h2 className="section-header mb-0">Recent Conversations</h2>
          <Link
            to="/conversations"
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View all →
          </Link>
        </div>
        {convsLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-700/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !recentConversations || recentConversations.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            No conversations yet
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {recentConversations.map((conv) => (
              <Link
                key={conv.id}
                to={`/conversations/${conv.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-700/30 transition-colors duration-100"
              >
                <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-sm">
                  {conv.firstName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">
                    {conv.firstName} {conv.lastName ?? ''}
                    {conv.username && (
                      <span className="text-gray-500 font-normal ml-1.5">@{conv.username}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {conv.title ?? 'Untitled conversation'} · {conv.messageCount} messages
                  </p>
                </div>
                <div className="text-xs text-gray-500 flex-shrink-0">
                  {formatRelativeTime(conv.lastActivityAt)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
