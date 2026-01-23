import type { AppleMusicSearchResponse, AppleMusicTrack, SearchResult } from './types';

const API_BASE = 'https://amp-api.music.apple.com/v1';

export async function searchTrack(
  song: string,
  artist: string,
  token: string,
  storefront: string = 'us'
): Promise<SearchResult | null> {
  const query = `${song} ${artist}`.trim();
  const searchUrl = `${API_BASE}/catalog/${storefront}/search?term=${encodeURIComponent(query)}&types=songs&limit=10`;

  const response = await fetch(searchUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://music.apple.com',
      'Referer': 'https://music.apple.com/',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error(`Search failed: ${response.status}`);
  }

  const data: AppleMusicSearchResponse = await response.json();
  const tracks = data.results?.songs?.data;

  if (!tracks || tracks.length === 0) {
    return null;
  }

  // Score and rank tracks
  const scored = tracks
    .map((track) => scoreTrack(track, song, artist))
    .filter((result): result is SearchResult => result !== null)
    .sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

function scoreTrack(
  track: AppleMusicTrack,
  querySong: string,
  queryArtist: string
): SearchResult | null {
  // Extract album ID from relationships or URL
  let albumId = track.relationships?.albums?.data?.[0]?.id;

  if (!albumId) {
    // Try to extract from URL: https://music.apple.com/us/album/song-name/1234567890?i=track
    const urlMatch = track.attributes.url.match(/\/album\/[^/]+\/(\d+)/);
    if (urlMatch) {
      albumId = urlMatch[1];
    }
  }

  if (!albumId) {
    return null;
  }

  const trackName = normalize(track.attributes.name);
  const trackArtist = normalize(track.attributes.artistName);
  const searchSong = normalize(querySong);
  const searchArtist = normalize(queryArtist);

  let score = 0;

  // Exact match bonuses
  if (trackName === searchSong) {
    score += 100;
  } else if (trackName.includes(searchSong) || searchSong.includes(trackName)) {
    score += 50;
  } else if (hasWordOverlap(trackName, searchSong)) {
    score += 25;
  }

  // Artist matching
  if (trackArtist === searchArtist) {
    score += 100;
  } else if (trackArtist.includes(searchArtist) || searchArtist.includes(trackArtist)) {
    score += 50;
  } else if (hasWordOverlap(trackArtist, searchArtist)) {
    score += 25;
  }

  // Penalize remixes, live versions, etc. unless explicitly searched
  const lowerTrackName = trackName.toLowerCase();
  if (!searchSong.includes('remix') && lowerTrackName.includes('remix')) {
    score -= 30;
  }
  if (!searchSong.includes('live') && (lowerTrackName.includes('live') || lowerTrackName.includes('(live'))) {
    score -= 20;
  }
  if (!searchSong.includes('acoustic') && lowerTrackName.includes('acoustic')) {
    score -= 15;
  }

  return {
    track,
    albumId,
    score,
  };
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWordOverlap(a: string, b: string): boolean {
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  for (const word of wordsA) {
    if (word.length > 2 && wordsB.has(word)) {
      return true;
    }
  }
  return false;
}
