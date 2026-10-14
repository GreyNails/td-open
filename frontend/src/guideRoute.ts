export type GuidePage =
  "start" | "ai" | "mcp" | "http" | "io" | "local" | "tidal";

export function guideFromHash(hash = window.location.hash): GuidePage | null {
  const page = hash.match(
    /^#guide\/(start|ai|mcp|http|io|local|tidal)(?:\/|$)/,
  )?.[1];
  return (page as GuidePage | undefined) || null;
}
