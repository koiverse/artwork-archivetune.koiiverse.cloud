import type { Env } from './types';
import * as cache from './cache';

const TOKEN_CACHE_KEY = 'apple_music_token';
const TOKEN_TTL_SECONDS = 3600; // 1 hour

// Overloaded function: works with or without Env (for Railway vs Cloudflare)
export async function getToken(env?: Env): Promise<string> {
  // Check cache first (use in-memory for Railway, KV for Cloudflare)
  if (env?.CACHE) {
    const cached = await env.CACHE.get(TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }
  } else {
    const cached = cache.get(TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }
  }

  // Fetch token from Apple Music
  const token = await scrapeToken();

  // Cache the token
  if (env?.CACHE) {
    await env.CACHE.put(TOKEN_CACHE_KEY, token, {
      expirationTtl: TOKEN_TTL_SECONDS,
    });
  } else {
    cache.set(TOKEN_CACHE_KEY, token, TOKEN_TTL_SECONDS);
  }

  return token;
}

async function scrapeToken(): Promise<string> {
  // Fetch the main Apple Music browse page
  const browseResponse = await fetch('https://music.apple.com/us/browse', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!browseResponse.ok) {
    throw new Error(`Failed to fetch Apple Music browse page: ${browseResponse.status}`);
  }

  const html = await browseResponse.text();

  // Extract the JS bundle path - format: /assets/index~HASH.js
  const jsPathMatch = html.match(/\/assets\/index[~-][a-zA-Z0-9]+\.js/);
  if (!jsPathMatch) {
    throw new Error('Could not find JS bundle path in Apple Music page');
  }

  const jsPath = jsPathMatch[0];
  const jsUrl = `https://music.apple.com${jsPath}`;

  // Fetch the JS bundle
  const jsResponse = await fetch(jsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!jsResponse.ok) {
    throw new Error(`Failed to fetch JS bundle: ${jsResponse.status}`);
  }

  const jsContent = await jsResponse.text();

  // Extract JWT token - look for the developer token pattern
  // Format: eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6"..."}
  const tokenMatch = jsContent.match(/"(eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6[^"]+)"/);
  if (tokenMatch) {
    return tokenMatch[1];
  }

  // Fallback: find any JWT with three parts
  const jwtMatch = jsContent.match(/"(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})"/);
  if (jwtMatch) {
    return jwtMatch[1];
  }

  throw new Error('Could not extract JWT token from JS bundle');
}

export async function invalidateToken(env?: Env): Promise<void> {
  if (env?.CACHE) {
    await env.CACHE.delete(TOKEN_CACHE_KEY);
  } else {
    cache.del(TOKEN_CACHE_KEY);
  }
}
