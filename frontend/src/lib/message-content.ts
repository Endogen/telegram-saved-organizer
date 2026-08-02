export type LinkProvider = "github" | "youtube" | "twitter" | "generic";

export type MessageLink = {
  url: string;
  provider: LinkProvider;
  providerLabel: string;
  hostname: string;
  title: string;
  description: string;
  youtubeVideoId: string | null;
};

export type MessageContentAnalysis = {
  text: string | null;
  isPureUrl: boolean;
  link: MessageLink | null;
};

const URL_CANDIDATE_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const SIMPLE_TRAILING_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", "\"", "'"]);
const CLOSING_PAIRS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function occurrences(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length;
}

export function trimUrlPunctuation(value: string): string {
  let normalized = value.trim();

  while (normalized.length > 0) {
    const finalCharacter = normalized.at(-1)!;
    if (SIMPLE_TRAILING_PUNCTUATION.has(finalCharacter)) {
      normalized = normalized.slice(0, -1);
      continue;
    }

    const openingCharacter = CLOSING_PAIRS[finalCharacter];
    if (
      openingCharacter !== undefined
      && occurrences(normalized, finalCharacter) > occurrences(normalized, openingCharacter)
    ) {
      normalized = normalized.slice(0, -1);
      continue;
    }
    break;
  }

  return normalized;
}

export function parseHttpUrl(value: string | null | undefined): URL | null {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }

  try {
    const candidate = trimUrlPunctuation(value);
    const parsed = new URL(/^www\./i.test(candidate) ? `https://${candidate}` : candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function extractFirstHttpUrl(content: string): URL | null {
  for (const match of content.matchAll(URL_CANDIDATE_PATTERN)) {
    const parsed = parseHttpUrl(match[0]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map(decoded);
}

function githubLink(url: URL): MessageLink {
  const segments = pathSegments(url);
  const owner = segments[0];
  const repository = segments[1]?.replace(/\.git$/i, "");
  const resource = segments[2]?.toLowerCase();
  const resourceId = segments[3];

  let description = "GitHub";
  if (owner !== undefined && repository !== undefined) {
    description = "Repository";
    if (resource === "issues" && resourceId !== undefined) {
      description = `Issue #${resourceId}`;
    } else if (resource === "pull" && resourceId !== undefined) {
      description = `Pull request #${resourceId}`;
    } else if (resource === "commit" && resourceId !== undefined) {
      description = `Commit ${resourceId.slice(0, 7)}`;
    } else if (resource === "blob") {
      description = `Code · ${segments.at(-1) ?? repository}`;
    } else if (resource === "tree") {
      description = "Repository directory";
    } else if (resource === "releases") {
      description = "Releases";
    }
  }

  return {
    url: url.href,
    provider: "github",
    providerLabel: "GitHub",
    hostname: "github.com",
    title: owner !== undefined && repository !== undefined ? `${owner}/${repository}` : "GitHub",
    description,
    youtubeVideoId: null,
  };
}

function youtubeVideoId(url: URL): string | null {
  const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
  const segments = pathSegments(url);
  const candidate = hostname === "youtu.be"
    ? segments[0]
    : url.searchParams.get("v") ?? (["shorts", "embed", "live"].includes(segments[0] ?? "") ? segments[1] : null);
  return candidate !== null && /^[a-z0-9_-]{6,20}$/i.test(candidate) ? candidate : null;
}

function youtubeLink(url: URL): MessageLink {
  const videoId = youtubeVideoId(url);
  return {
    url: url.href,
    provider: "youtube",
    providerLabel: "YouTube",
    hostname: url.hostname.replace(/^www\./i, ""),
    title: videoId === null ? "YouTube" : "Watch on YouTube",
    description: videoId === null ? "Video link" : `Video · ${videoId}`,
    youtubeVideoId: videoId,
  };
}

function twitterLink(url: URL): MessageLink {
  const segments = pathSegments(url);
  const account = segments[0];
  const isStatus = segments[1]?.toLowerCase() === "status" && segments[2] !== undefined;
  return {
    url: url.href,
    provider: "twitter",
    providerLabel: "X / Twitter",
    hostname: url.hostname.replace(/^www\./i, ""),
    title: account === undefined ? "X / Twitter" : `@${account}`,
    description: isStatus ? `Post on X · ${segments[2]}` : "Profile on X",
    youtubeVideoId: null,
  };
}

function genericLink(url: URL): MessageLink {
  const hostname = url.hostname.replace(/^www\./i, "");
  const path = decoded(url.pathname).replace(/\/$/, "");
  const pathLabel = path.length > 1 ? path : "Website";
  return {
    url: url.href,
    provider: "generic",
    providerLabel: "Web link",
    hostname,
    title: hostname || "Web link",
    description: pathLabel.length > 72 ? `${pathLabel.slice(0, 71)}…` : pathLabel,
    youtubeVideoId: null,
  };
}

function classifyLink(url: URL): MessageLink {
  const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (hostname === "github.com" || hostname.endsWith(".github.com")) {
    return githubLink(url);
  }
  if (
    hostname === "youtu.be"
    || hostname === "youtube.com"
    || hostname.endsWith(".youtube.com")
    || hostname === "youtube-nocookie.com"
  ) {
    return youtubeLink(url);
  }
  if (["x.com", "mobile.x.com", "twitter.com", "mobile.twitter.com"].includes(hostname)) {
    return twitterLink(url);
  }
  return genericLink(url);
}

export function analyzeMessageContent(content: string | null, rawUrl: string | null): MessageContentAnalysis {
  const normalizedContent = content?.trim() ?? "";
  const explicitUrl = parseHttpUrl(rawUrl);
  const contentUrl = extractFirstHttpUrl(normalizedContent);
  const parsedUrl = explicitUrl ?? contentUrl;
  const pureContentUrl = parseHttpUrl(normalizedContent);
  const isPureUrl = normalizedContent.length > 0
    && !/\s/.test(normalizedContent)
    && pureContentUrl !== null;

  let text: string | null = normalizedContent.length > 0 && !isPureUrl ? normalizedContent : null;
  if (text === null && parsedUrl === null && rawUrl !== null && rawUrl.trim().length > 0) {
    text = rawUrl.trim();
  }

  return {
    text,
    isPureUrl,
    link: parsedUrl === null ? null : classifyLink(parsedUrl),
  };
}

export function messageTextParts(text: string): Array<{ value: string; url: string | null }> {
  const parts: Array<{ value: string; url: string | null }> = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_CANDIDATE_PATTERN)) {
    const index = match.index;
    if (index > cursor) {
      parts.push({ value: text.slice(cursor, index), url: null });
    }

    const candidate = match[0];
    const cleaned = trimUrlPunctuation(candidate);
    const parsed = parseHttpUrl(cleaned);
    parts.push({ value: cleaned, url: parsed?.href ?? null });
    if (cleaned.length < candidate.length) {
      parts.push({ value: candidate.slice(cleaned.length), url: null });
    }
    cursor = index + candidate.length;
  }

  if (cursor < text.length) {
    parts.push({ value: text.slice(cursor), url: null });
  }
  return parts.length > 0 ? parts : [{ value: text, url: null }];
}
