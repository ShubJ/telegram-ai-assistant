import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import type { BotStatus } from '../types';

interface NavItem {
  to: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',              icon: '📊', label: 'Dashboard'     },
  { to: '/conversations', icon: '💬', label: 'Conversations' },
  { to: '/users',         icon: '👥', label: 'Users'         },
  { to: '/memories',      icon: '🧠', label: 'Memories'      },
  { to: '/personality',   icon: '🎭', label: 'Personality'   },
  { to: '/skills',        icon: '⚡', label: 'Skills'        },
  { to: '/todos',         icon: '✅', label: 'Todos'         },
  { to: '/reminders',     icon: '🔔', label: 'Reminders'     },
];

interface SidebarProps {
  onSignOut?: () => void;
}

export default function Sidebar({ onSignOut }: SidebarProps) {
  const location = useLocation();
  const { data: status } = useApi<BotStatus>('/bot/status', { deps: [] });

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-gray-900 border-r border-gray-800 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex-shrink-0">
          <span className="text-lg">🤖</span>
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight">Atlas AI</p>
          <p className="text-gray-500 text-xs truncate">Admin Dashboard</p>
        </div>
      </div>

      {/* Bot Status */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-gray-800/60">
          <span
            className={`relative flex h-2.5 w-2.5 flex-shrink-0`}
            title={status?.isOnline ? 'Bot online' : 'Bot offline'}
          >
            {status?.isOnline && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                status?.isOnline ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-300">
              {status?.isOnline ? 'Bot Online' : 'Bot Offline'}
            </p>
            {status?.botUsername && (
              <p className="text-xs text-gray-500 truncate">@{status.botUsername}</p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-800">
        <button
          onClick={onSignOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium
                     text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors duration-150"
        >
          <span className="text-base leading-none">🚪</span>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
