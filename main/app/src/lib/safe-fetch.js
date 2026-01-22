/**
 * Safe Fetch Utility
 *
 * Provides SSRF protection for fetching external documents
 * Validates domains, protocols, and content size before fetching
 *
 * @module SafeFetch
 */

import { URL } from 'url';

const ALLOWED_DOCUMENT_DOMAINS = [
  'amazonaws.com',
  'amazon.com',
  'cloudfront.net',
  'amazoncontent.com',
];

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_CONTENT_LENGTH = 100 * 1024 * 1024; // 100MB

export class SafeFetchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

/**
 * Fetch a URL with safety checks
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} options.timeout - Timeout in ms (default 30s)
 * @param {number} options.maxSize - Max response size in bytes (default 100MB)
 * @param {string[]} options.allowedDomains - Allowed domain suffixes
 * @returns {Promise<Response>} - Fetch response
 */
export async function safeFetch(url, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    maxSize = MAX_CONTENT_LENGTH,
    allowedDomains = ALLOWED_DOCUMENT_DOMAINS,
  } = options;

  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    throw new SafeFetchError(`Invalid URL: ${url}`, 'INVALID_URL');
  }

  // Validate protocol
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new SafeFetchError(`Invalid protocol: ${parsedUrl.protocol}`, 'INVALID_PROTOCOL');
  }

  // Validate domain
  const hostname = parsedUrl.hostname.toLowerCase();
  const isAllowedDomain = allowedDomains.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );

  if (!isAllowedDomain) {
    throw new SafeFetchError(
      `Domain not allowed: ${hostname}. Allowed: ${allowedDomains.join(', ')}`,
      'DOMAIN_NOT_ALLOWED'
    );
  }

  // Validate not internal IP (basic check)
  if (hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
    throw new SafeFetchError('Internal IP addresses not allowed', 'INTERNAL_IP');
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AmazonListingHelper/1.0',
      },
    });

    // Check final URL after redirects
    if (response.url) {
      const finalUrl = new URL(response.url);
      const finalHostname = finalUrl.hostname.toLowerCase();
      const isFinalAllowed = allowedDomains.some(domain =>
        finalHostname === domain || finalHostname.endsWith('.' + domain)
      );

      if (!isFinalAllowed) {
        throw new SafeFetchError(
          `Redirect to disallowed domain: ${finalHostname}`,
          'REDIRECT_DISALLOWED'
        );
      }
    }

    // Check content length header
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > maxSize) {
      throw new SafeFetchError(
        `Content too large: ${contentLength} bytes (max: ${maxSize})`,
        'CONTENT_TOO_LARGE'
      );
    }

    if (!response.ok) {
      throw new SafeFetchError(
        `HTTP error: ${response.status} ${response.statusText}`,
        'HTTP_ERROR'
      );
    }

    return response;

  } catch (error) {
    // Re-throw SafeFetchError as-is
    if (error instanceof SafeFetchError) {
      throw error;
    }

    // Handle AbortError (timeout)
    if (error.name === 'AbortError') {
      throw new SafeFetchError(`Request timeout after ${timeout}ms`, 'TIMEOUT');
    }

    // Wrap other errors
    throw new SafeFetchError(`Fetch failed: ${error.message}`, 'FETCH_ERROR');

  } finally {
    clearTimeout(timeoutId);
  }
}

export default safeFetch;
