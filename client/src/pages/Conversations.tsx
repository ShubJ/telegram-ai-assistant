import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { apiClient, ApiError } from '../api/client';
import ChatBubble from '../components/ChatBubble';
import Modal from '../components/Modal';
import type { Conversation, ConversationWithMessages } from '../types';

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

function ConversationDetail({
  conversationId,
  onDelete,
}: {
  conversationId: number;
  onDelete: () => void;
}) {
  const { data, loading, error, refetch } = useApi<ConversationWithMessages>(
    `/conversations/${conversationId}`,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (data) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [data]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiClient.delete(`/conversations/${conversationId}`);
      onDelete();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete conversation');
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button onClick={refetch} className="btn-secondary text-xs">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const messages = data.messages ?? [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0 bg-gray-800/50">
        <div>
          <h2 className="text-sm font-semibold text-white">
            {data.title ?? 'Untitled Conversation'}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.firstName} {data.lastName ?? ''}
            {data.username && ` (@${data.username})`}
            {' · '}{messages.length} messages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfirm(true)}
            className="btn-danger text-xs px-3 py-1.5"
          >
            🗑 Delete
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No messages in this conversation
          </div>
        ) : (
          messages.map((msg) => <ChatBubble key={msg.id} message={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Confirm Delete Modal */}
      {showConfirm && (
        <Modal
          title="Delete Conversation"
          onClose={() => setShowConfirm(false)}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setShowConfirm(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn-danger"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-gray-300 text-sm">
            Are you sure you want to delete this conversation and all its messages? This action
            cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default function Conversations() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [filterUser, setFilterUser] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const queryParams = new URLSearchParams();
  queryParams.set('limit', String(PAGE_SIZE));
  queryParams.set('offset', String(page * PAGE_SIZE));
  if (filterUser) queryParams.set('userId', filterUser);

  const { data: conversations, loading, error, refetch } = useApi<Conversation[]>(
    `/conversations?${queryParams.toString()}`,
    { deps: [filterUser, page] },
  );

  const selectedId = id ? parseInt(id, 10) : null;

  function handleConvDeleted() {
    refetch();
    navigate('/conversations');
  }

  return (
    <div className="flex h-full min-h-0 gap-0 -m-6 animate-fade-in">
      {/* Conversation List */}
      <div className="w-72 xl:w-80 flex-shrink-0 flex flex-col border-r border-gray-700 bg-gray-900 min-h-0">
        {/* List Header */}
        <div className="px-4 py-4 border-b border-gray-700">
          <h1 className="text-lg font-bold text-white mb-3">Conversations</h1>
          <input
            type="text"
            className="input"
            placeholder="Filter by user ID..."
            value={filterUser}
            onChange={(e) => {
              setFilterUser(e.target.value);
              setPage(0);
            }}
          />
        </div>

        {/* List Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="p-4 text-red-400 text-sm">{error}</div>
          ) : !conversations || conversations.length === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">
              No conversations found
            </div>
          ) : (
            conversations.map((conv) => (
              <Link
                key={conv.id}
                to={`/conversations/${conv.id}`}
                className={`block px-4 py-3.5 border-b border-gray-700/50 transition-colors duration-100
                  ${selectedId === conv.id
                    ? 'bg-indigo-600/15 border-l-2 border-l-indigo-500'
                    : 'hover:bg-gray-800'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-indigo-300 mt-0.5">
                    {conv.firstName?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-medium text-gray-200 truncate">
                        {conv.firstName} {conv.lastName ?? ''}
                      </p>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {formatRelativeTime(conv.lastActivityAt)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {conv.title ?? 'Untitled'} · {conv.messageCount} msgs
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Pagination */}
        {conversations && conversations.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 text-xs text-gray-400">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="disabled:opacity-40 hover:text-gray-200 transition-colors"
            >
              ← Prev
            </button>
            <span>Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(conversations?.length ?? 0) < PAGE_SIZE}
              className="disabled:opacity-40 hover:text-gray-200 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Detail Panel */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {selectedId ? (
          <ConversationDetail
            conversationId={selectedId}
            onDelete={handleConvDeleted}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <div className="text-4xl mb-3">💬</div>
              <p className="text-gray-400 text-sm">
                Select a conversation to view messages
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
