// source.ts — The Source type for Glow
// Represents a readable markdown source.

/** A readable markdown source with its associated URL. */
export interface Source {
  /** The content body of the source. */
  body: string;
  /** The URL or path of the source. */
  url: string;
}
