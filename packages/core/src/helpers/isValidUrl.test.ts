import { describe, it, expect } from 'vitest';
import { isValidUrl, extractUrls } from './isValidUrl.js';

describe('isValidUrl', () => {
  describe('valid URLs', () => {
    it('accepts https URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('accepts http URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
    });

    it('accepts URLs with paths', () => {
      expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
    });

    it('accepts URLs with query params', () => {
      expect(isValidUrl('https://example.com?q=search&page=1')).toBe(true);
    });

    it('accepts URLs with fragments', () => {
      expect(isValidUrl('https://example.com#section')).toBe(true);
    });

    it('accepts URLs with port', () => {
      expect(isValidUrl('http://localhost:3000')).toBe(true);
    });
  });

  describe('invalid URLs', () => {
    it('rejects plain text', () => {
      expect(isValidUrl('not a url')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidUrl('')).toBe(false);
    });

    it('rejects javascript: URLs', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects data: URLs', () => {
      expect(isValidUrl('data:text/html,<h1>hi</h1>')).toBe(false);
    });

    it('rejects file: URLs', () => {
      expect(isValidUrl('file:///etc/passwd')).toBe(false);
    });

    it('rejects ftp: URLs by default', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('custom protocols', () => {
    it('accepts mailto: when included', () => {
      expect(isValidUrl('mailto:test@example.com', { protocols: ['mailto:'] })).toBe(true);
    });

    it('accepts tel: when included', () => {
      expect(isValidUrl('tel:+1234567890', { protocols: ['tel:'] })).toBe(true);
    });

    it('rejects http when not in protocols', () => {
      expect(isValidUrl('http://example.com', { protocols: ['https:'] })).toBe(false);
    });

    it('accepts custom protocols', () => {
      expect(isValidUrl('ftp://files.example.com', { protocols: ['ftp:'] })).toBe(true);
    });
  });
});

describe('extractUrls', () => {
  it('extracts http URLs from text', () => {
    const result = extractUrls('Visit http://example.com for info');
    expect(result).toEqual(['http://example.com']);
  });

  it('extracts https URLs from text', () => {
    const result = extractUrls('Visit https://example.com for info');
    expect(result).toEqual(['https://example.com']);
  });

  it('extracts multiple URLs', () => {
    const result = extractUrls('See https://a.com and https://b.com');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('extracts URLs with paths', () => {
    const result = extractUrls('Go to https://example.com/path/page');
    expect(result).toEqual(['https://example.com/path/page']);
  });

  it('returns empty array when no URLs', () => {
    const result = extractUrls('No URLs here');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    const result = extractUrls('');
    expect(result).toEqual([]);
  });
});
