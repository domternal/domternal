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

  describe('hardened with the URL policy', () => {
    it('answers the edge-case matrix row A28', () => {
      expect(isValidUrl('https://x.example', {})).toBe(true);
      expect(isValidUrl('/x')).toBe(false);
      expect(isValidUrl(['https://x.example'])).toBe(false);
    });

    it('refuses values that are not strings instead of stringifying them', () => {
      expect(isValidUrl(['javascript:alert(1)'], { protocols: ['javascript:'] })).toBe(false);
      expect(isValidUrl({ toString: () => 'https://example.com' })).toBe(false);
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
      expect(isValidUrl(42)).toBe(false);
    });

    it('refuses credentials, which make an address read as another host', () => {
      expect(isValidUrl('https://google.com@evil.example/')).toBe(false);
      expect(isValidUrl('https://user:pass@example.com/')).toBe(false);
    });

    it('refuses script and data schemes even when they are listed', () => {
      expect(isValidUrl('javascript:alert(1)', { protocols: ['javascript:'] })).toBe(false);
      expect(isValidUrl('vbscript:msgbox(1)', { protocols: ['vbscript:'] })).toBe(false);
      expect(isValidUrl('data:text/html,x', { protocols: ['data:'] })).toBe(false);
    });

    it('refuses hidden characters and backslashes', () => {
      expect(isValidUrl('https://exa\u200bmple.com/')).toBe(false);
      expect(isValidUrl('\u202ehttps://example.com/')).toBe(false);
      expect(isValidUrl('https:\\\\evil.example')).toBe(false);
    });

    it('judges the address a browser reads: outer controls, tabs and line breaks do not count', () => {
      expect(isValidUrl(' https://example.com/ ')).toBe(true);
      expect(isValidUrl('https://exa\nmple.com/')).toBe(true);
      expect(isValidUrl(' java\tscript:alert(1)', { protocols: ['http:', 'https:', 'javascript:'] })).toBe(false);
    });

    it('accepts protocol entries in any case, with or without the colon', () => {
      expect(isValidUrl('https://example.com', { protocols: ['HTTPS'] })).toBe(true);
      expect(isValidUrl('https://example.com', { protocols: ['https'] })).toBe(true);
    });

    it('accepts relative references with allowRelative', () => {
      expect(isValidUrl('#section', { allowRelative: true })).toBe(true);
      expect(isValidUrl('/docs/page?x=1', { allowRelative: true })).toBe(true);
      expect(isValidUrl('//evil.example/x', { allowRelative: true })).toBe(false);
    });
  });
});
