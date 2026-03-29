// ============================================================
// Enums
// ============================================================

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export enum MemoryType {
  Fact = 'fact',
  Preference = 'preference',
  Event = 'event',
  Relationship = 'relationship',
}

export enum SkillName {
  WebSearch = 'web_search',
  Weather = 'weather',
  Reminders = 'reminders',
  Todos = 'todos',
  Calculator = 'calculator',
  Notes = 'notes',
  ImageAnalysis = 'image_analysis',
  CodeExecution = 'code_execution',
}

// ============================================================
// Core Domain Interfaces
// ============================================================

export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  isAdmin: boolean;
  timezone: string;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  language?: string;
  notificationsEnabled?: boolean;
  summaryFrequency?: 'daily' | 'weekly' | 'never';
  [key: string]: unknown;
}

export interface Message {
  id: number;
  userId: number;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  skillUsed?: SkillName;
  tokensUsed?: number;
  processingTimeMs?: number;
  telegramMessageId?: number;
  [key: string]: unknown;
}

export interface Memory {
  id: number;
  userId: number;
  type: MemoryType;
  content: string;
  /** Importance score from 1 (low) to 10 (high) */
  importance: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
}

export interface Conversation {
  id: number;
  userId: number;
  messages: Message[];
  startedAt: Date;
  lastMessageAt: Date;
}

// ============================================================
// Skills
// ============================================================

export interface Skill {
  name: SkillName;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface SkillResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

// ============================================================
// Personality & Bot Configuration
// ============================================================

export interface PersonalityConfig {
  name: string;
  systemPrompt: string;
  traits: string[];
  tone: 'formal' | 'casual' | 'friendly' | 'professional' | 'humorous';
  responseStyle: 'concise' | 'detailed' | 'balanced';
}

// ============================================================
// Admin & Stats
// ============================================================

export interface AdminUser {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  grantedAt: Date;
}

export interface BotStats {
  totalUsers: number;
  totalMessages: number;
  activeConversations: number;
  uptime: number;
  memoryCount: number;
}

// ============================================================
// API Responses
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================
// Reminders & Todos
// ============================================================

export interface ReminderEntry {
  id: number;
  userId: number;
  text: string;
  cronExpression: string;
  nextRun: Date;
  active: boolean;
}

export interface TodoItem {
  id: number;
  userId: number;
  text: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  completedAt: Date | null;
}
