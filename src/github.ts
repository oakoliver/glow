// github.ts — GitHub API README fetching for Glow
// Port of charmbracelet/glow/github.go

import type { Source } from './source.js';

interface GitHubReadme {
  download_url: string;
}

/**
 * Find the README in a GitHub repository using the GitHub API.
 * @param u - A parsed URL like https://github.com/owner/repo
 */
export async function findGitHubREADME(u: URL): Promise<Source | null> {
  const pathParts = u.pathname.replace(/^\//, '').split('/');
  if (pathParts.length < 2) {
    return null;
  }
  const owner = pathParts[0];
  const repo = pathParts[1];

  const apiURL = `https://api.${u.hostname}/repos/${owner}/${repo}/readme`;

  try {
    const res = await fetch(apiURL, {
      headers: { 'User-Agent': 'glow-ts/1.0' },
    });
    if (res.status !== 200) {
      return null;
    }
    const data = (await res.json()) as GitHubReadme;
    if (!data.download_url) {
      return null;
    }

    const contentRes = await fetch(data.download_url);
    if (contentRes.status !== 200) {
      return null;
    }

    const body = await contentRes.text();
    return { body, url: data.download_url };
  } catch {
    return null;
  }
}
