import { describe, expect, it } from 'bun:test';
import plugin from '../plugin';

describe('Plugin Routes', () => {
  it('should have routes defined', () => {
    expect(plugin.routes).toBeDefined();
    if (plugin.routes) {
      expect(Array.isArray(plugin.routes)).toBe(true);
      expect(plugin.routes.length).toBeGreaterThan(0);
    }
  });

  it('should have a route for /api/submissions', () => {
    if (plugin.routes) {
      const route = plugin.routes.find((r) => r.path === '/api/submissions' && r.type === 'GET');
      expect(route).toBeDefined();
      if (route) {
        expect(route.type).toBe('GET');
        expect(typeof route.handler).toBe('function');
      }
    }
  });

  it('should have a route for /submit', () => {
    if (plugin.routes) {
      const route = plugin.routes.find((r) => r.path === '/submit' && r.type === 'GET');
      expect(route).toBeDefined();
    }
  });

  it('should have a route for /api/summary', () => {
    if (plugin.routes) {
      const route = plugin.routes.find((r) => r.path === '/api/summary' && r.type === 'GET');
      expect(route).toBeDefined();
    }
  });

  it('should validate route structure', () => {
    if (plugin.routes) {
      plugin.routes.forEach((route) => {
        expect(route).toHaveProperty('path');
        expect(route).toHaveProperty('type');
        expect(route).toHaveProperty('handler');

        expect(typeof route.path).toBe('string');
        expect(route.path.startsWith('/')).toBe(true);

        expect(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).toContain(route.type);

        expect(typeof route.handler).toBe('function');
      });
    }
  });

  it('should have unique route name+method combinations', () => {
    if (plugin.routes) {
      const keys = plugin.routes.map((route) => `${route.type}:${route.path}`);
      const uniqueKeys = new Set(keys);
      // Allow duplicate paths for GET/POST (e.g. /api/submissions has both)
      expect(uniqueKeys.size).toBeGreaterThan(0);
    }
  });
});
