import { describe, expect, it } from 'vitest';
import {
  classifyProviderError,
  ProviderAuthError,
  ProviderConnectionError,
  ProviderEmptyResultError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from '../../../src/providers/errors.js';

describe('classifyProviderError', () => {
  it('passes through an existing ProviderError unchanged', () => {
    const original = new ProviderEmptyResultError('empty', 'p');
    expect(classifyProviderError(original, 'p')).toBe(original);
  });

  it('maps HTTP 429 to a rate-limit error', () => {
    expect(classifyProviderError({ status: 429, message: 'too many' }, 'p')).toBeInstanceOf(
      ProviderRateLimitError,
    );
  });

  it('maps 401/403 to an auth error', () => {
    expect(classifyProviderError({ status: 401 }, 'p')).toBeInstanceOf(ProviderAuthError);
    expect(classifyProviderError({ statusCode: 403 }, 'p')).toBeInstanceOf(ProviderAuthError);
  });

  it('reads a nested response.status', () => {
    expect(classifyProviderError({ response: { status: 429 } }, 'p')).toBeInstanceOf(
      ProviderRateLimitError,
    );
  });

  it('maps timeout messages to a timeout error', () => {
    expect(classifyProviderError(new Error('request timed out'), 'p')).toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it('maps connection-ish messages to a connection error', () => {
    expect(classifyProviderError(new Error('ECONNRESET socket closed'), 'p')).toBeInstanceOf(
      ProviderConnectionError,
    );
  });

  it('defaults an unrecognised error to a (recoverable) connection error', () => {
    const err = classifyProviderError('something weird', 'p');
    expect(err).toBeInstanceOf(ProviderConnectionError);
    expect(err.recoverable).toBe(true);
  });
});

describe('ProviderError subclasses', () => {
  it('carry the right code and recoverability', () => {
    expect(new ProviderRateLimitError('m', 'p').recoverable).toBe(true);
    expect(new ProviderRateLimitError('m', 'p').code).toBe('provider_rate_limit');
    expect(new ProviderAuthError('m', 'p').recoverable).toBe(false);
    expect(new ProviderAuthError('m', 'p').code).toBe('provider_auth');
    expect(new ProviderTimeoutError('m', 'p').code).toBe('provider_timeout');
    expect(new ProviderConnectionError('m', 'p').code).toBe('provider_connection');
    expect(new ProviderEmptyResultError('m', 'p').code).toBe('provider_empty_result');
    expect(new ProviderRateLimitError('m', 'p').provider).toBe('p');
  });
});
