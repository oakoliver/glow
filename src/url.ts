// url.ts — URL protocol routing for Glow
// Port of charmbracelet/glow/url.go

import { findGitHubREADME } from './github.js';
import { findGitLabREADME } from './gitlab.js';
import type { Source } from './source.js';

const PROTO_GITHUB = 'github://';
const PROTO_GITLAB = 'gitlab://';
const PROTO_HTTPS = 'https://';

const GITHUB_HOSTNAME = 'github.com';
const GITLAB_HOSTNAME = 'gitlab.com';

/**
 * Attempt to resolve a path to a README URL from GitHub/GitLab.
 * Returns a Source if the path is a recognized repository URL, or null.
 */
export async function readmeURL(path: string): Promise<Source | null> {
  // github:// protocol
  if (path.startsWith(PROTO_GITHUB)) {
    const u = githubReadmeURL(path);
    if (u) {
      return readmeURL(u);
    }
    return null;
  }

  // gitlab:// protocol
  if (path.startsWith(PROTO_GITLAB)) {
    const u = gitlabReadmeURL(path);
    if (u) {
      return readmeURL(u);
    }
    return null;
  }

  // Ensure https:// prefix for hostname matching
  if (!path.startsWith(PROTO_HTTPS)) {
    path = PROTO_HTTPS + path;
  }

  let u: URL;
  try {
    u = new URL(path);
  } catch {
    return null;
  }

  if (u.hostname === GITHUB_HOSTNAME) {
    return findGitHubREADME(u);
  }
  if (u.hostname === GITLAB_HOSTNAME) {
    return findGitLabREADME(u);
  }

  return null;
}

/** Convert a github:// path to an https://github.com URL. */
function githubReadmeURL(path: string): string | null {
  const stripped = path.slice(PROTO_GITHUB.length);
  const parts = stripped.split('/');
  if (parts.length !== 2) {
    // custom hostnames not supported yet
    return null;
  }
  return `https://${GITHUB_HOSTNAME}/${stripped}`;
}

/** Convert a gitlab:// path to an https://gitlab.com URL. */
function gitlabReadmeURL(path: string): string | null {
  const stripped = path.slice(PROTO_GITLAB.length);
  const parts = stripped.split('/');
  if (parts.length !== 2) {
    // custom hostnames not supported yet
    return null;
  }
  return `https://${GITLAB_HOSTNAME}/${stripped}`;
}

/** Check if a string is a URL (has a protocol). */
export function isURL(path: string): boolean {
  try {
    const u = new URL(path);
    return !!u.protocol;
  } catch {
    return false;
  }
}
