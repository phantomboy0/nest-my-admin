export type RouteHandler<S> = (state: S, params: Record<string, string>) => void | Promise<void>;

interface Route<S> {
  method: string;
  segments: string[];
  handler: RouteHandler<S>;
}

/** Minimal router for the admin API. Independent of Express/path-to-regexp versions (spec D12). */
export class Router<S> {
  private readonly routes: Route<S>[] = [];

  add(method: string, pattern: string, handler: RouteHandler<S>): this {
    this.routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  match(method: string, pathname: string): { handler: RouteHandler<S>; params: Record<string, string> } | undefined {
    const parts = split(pathname);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchSegments(route.segments, parts);
      if (params) return { handler: route.handler, params };
    }
    return undefined;
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** A trailing `*name` segment takes the rest of the path (at least one segment), decoded per segment and joined with `/`. */
function matchSegments(pattern: string[], parts: string[]): Record<string, string> | undefined {
  const wildcard = pattern.length > 0 && pattern[pattern.length - 1]!.startsWith('*');
  if (wildcard ? parts.length < pattern.length : pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i]!;
    if (wildcard && i === pattern.length - 1) {
      try {
        const rest = parts.slice(i).map(decodeURIComponent);
        if (rest.some((part) => part.includes('/'))) return undefined;
        params[expected.slice(1)] = rest.join('/');
      } catch {
        return undefined;
      }
      break;
    }
    const actual = parts[i]!;
    if (expected.startsWith(':')) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return undefined;
      }
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}
