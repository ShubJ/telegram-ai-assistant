/**
 * Custom error classes for structured error handling.
 *
 * All application errors extend AppError, which carries:
 *  - statusCode: HTTP status code to use in API responses
 *  - isOperational: true for expected errors (validation, auth, etc.),
 *    false for unexpected/programmer errors
 *
 * Usage:
 *   throw new ValidationError('Email is required');
 *   throw new ExternalServiceError('Anthropic', 'rate limited', originalError);
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Concrete error types
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly cause?: Error;

  constructor(service: string, message: string, cause?: Error) {
    super(`${service}: ${message}`, 502);
    this.service = service;
    this.cause = cause;
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 500, false);
    if (cause) {
      this.cause = cause;
    }
  }
}
