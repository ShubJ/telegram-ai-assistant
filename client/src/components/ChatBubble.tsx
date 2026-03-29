import React from 'react';
import type { Message } from '../types';

interface ChatBubbleProps {
  message: Message;
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <div className="px-3 py-1.5 rounded-full bg-gray-700/60 border border-gray-600/40 text-xs text-gray-400 italic max-w-md text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2 mb-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm
          ${isUser ? 'bg-indigo-600/30 border border-indigo-500/30' : 'bg-gray-700 border border-gray-600'}`}
      >
        {isUser ? '👤' : '🤖'}
      </div>

      {/* Bubble */}
      <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-indigo-600 text-white rounded-br-md'
              : 'bg-gray-700 text-gray-100 rounded-bl-md'
          }`}
        >
          {message.content}
        </div>
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-xs text-gray-500">{formatDate(message.createdAt)}</span>
          <span className="text-gray-600 text-xs">·</span>
          <span className="text-xs text-gray-500">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
