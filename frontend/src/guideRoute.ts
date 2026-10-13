export type GuidePage = "start" | "ai" | "mcp" | "http" | "io" | "local";

export function guideFromHash(hash = window.location.hash): GuidePage | null {
  const page = hash.match(/^#guide\/(start|ai|mcp|http|io|local)(?:\/|$)/)?.[1];
  return (page as GuidePage | undefined) || null;
}
