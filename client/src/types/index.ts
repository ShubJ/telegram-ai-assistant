// ─── Core Domain Types ────────────────────────────────────────────────────────

export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  isAdmin: boolean;
  timezone: string;
  languageCode: string | null;
  preferences: Record<string, unknown>;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Conversation {
  id: number;
  userId: number;
  title: string | null;
  isActive: boolean;
  messageCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  // Joined from users table
  username?: string | null;
  firstName?: string;
  lastName?: string | null;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface Memory {
  id: number;
  userId: number;
  content: string;
  type: 'fact' | 'preference' | 'event' | 'general';
  importance: 1 | 2 | 3 | 4 | 5;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  // Joined from users table
  username?: string | null;
  firstName?: string;
}

export interface PersonalityConfig {
  id: number;
  name: string;
  systemPrompt: string;
  traits: string[];
  tone: string;
  responseStyle: string;
  customInstructions: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: number;
  name: string;
  description: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Todo {
  id: number;
  userId: number;
  content: string;
  isCompleted: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined from users table
  username?: string | null;
  firstName?: string;
}

export interface Reminder {
  id: number;
  userId: number;
  content: string;
  scheduledAt: string;
  isActive: boolean;
  isSent: boolean;
  recurrence: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined from users table
  username?: string | null;
  firstName?: string;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  totalUsers: number;
  totalMessages: number;
  activeConversations: number;
  totalMemories: number;
  uptimeSeconds: number;
  todosCompleted: number;
  todosTotal: number;
  remindersActive: number;
}

export interface ActivityDataPoint {
  date: string;
  messageCount: number;
  userCount: number;
}

export interface BotStatus {
  isOnline: boolean;
  botUsername: string | null;
  lastActivity: string | null;
}

// ─── Form / UI Types ──────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

export type MemoryType = 'fact' | 'preference' | 'event' | 'general';
export type MemoryImportance = 1 | 2 | 3 | 4 | 5;
export type TodoPriority = 'low' | 'medium' | 'high';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface CreateMemoryPayload {
  userId: number;
  content: string;
  type: MemoryType;
  importance: MemoryImportance;
}

export interface UpdatePersonalityPayload {
  name: string;
  systemPrompt: string;
  traits: string[];
  tone: string;
  responseStyle: string;
  customInstructions?: string;
}

export interface UpdateUserPayload {
  isAdmin?: boolean;
  timezone?: string;
  preferences?: Record<string, unknown>;
}
