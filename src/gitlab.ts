// gitlab.ts — GitLab API README fetching for Glow
// Port of charmbracelet/glow/gitlab.go

import type { Source } from './source.js';

interface GitLabProject {
  readme_url: string;
}

/**
 * Find the README in a GitLab repository using the GitLab API.
 * @param u - A parsed URL like https://gitlab.com/owner/repo
 */
export async function findGitLabREADME(u: URL): Promise<Source | null> {
  const pathParts = u.pathname.replace(/^\//, '').split('/');
  if (pathParts.length < 2) {
    return null;
  }
  const owner = pathParts[0];
  const repo = pathParts[1];

  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const apiURL = `https://${u.hostname}/api/v4/projects/${projectPath}`;

  try {
    const res = await fetch(apiURL, {
      headers: { 'User-Agent': 'glow-ts/1.0' },
    });
    if (res.status !== 200) {
      return null;
    }
    const data = (await res.json()) as GitLabProject;
    if (!data.readme_url) {
      return null;
    }

    // Convert blob URL to raw URL
    const readmeRawURL = data.readme_url.replace('/blob/', '/raw/');

    const contentRes = await fetch(readmeRawURL);
    if (contentRes.status !== 200) {
      return null;
    }

    const body = await contentRes.text();
    return { body, url: readmeRawURL };
  } catch {
    return null;
  }
}
