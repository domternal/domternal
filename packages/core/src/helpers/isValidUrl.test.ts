import { describe, it, expect } from 'vitest';
import { isValidUrl } from './isValidUrl.js';

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
