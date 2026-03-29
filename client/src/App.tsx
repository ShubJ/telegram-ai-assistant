import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Conversations from './pages/Conversations';
import Users from './pages/Users';
import Memories from './pages/Memories';
import Personality from './pages/Personality';
import Skills from './pages/Skills';
import Todos from './pages/Todos';
import Reminders from './pages/Reminders';

function AppLayout() {
  const location = useLocation();
  // Conversations page gets full-height treatment for the chat panel layout
  const isConversations = location.pathname.startsWith('/conversations');

  function handleSignOut() {
    if (confirm('Sign out? You will need to enter the admin secret again.')) {
      localStorage.removeItem('adminSecret');
      window.location.reload();
    }
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <Sidebar onSignOut={handleSignOut} />

      {/* Main content */}
      <main className={`flex-1 overflow-auto ${isConversations ? 'flex flex-col' : ''}`}>
        {isConversations ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <Routes>
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/conversations/:id" element={<Conversations />} />
            </Routes>
          </div>
        ) : (
          <div className="p-6 max-w-7xl mx-auto w-full">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/memories" element={<Memories />} />
              <Route path="/personality" element={<Personality />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/todos" element={<Todos />} />
              <Route path="/reminders" element={<Reminders />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthGuard>
      <Routes>
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </AuthGuard>
  );
}
