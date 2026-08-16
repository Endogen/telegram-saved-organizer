import { type MouseEvent, useEffect, useState } from "react";
import { AtSign, Check, Copy, ExternalLink, Globe2, Github, Play, Youtube } from "lucide-react";

import { analyzeMessageContent, messageTextParts, type LinkProvider, type MessageLink } from "@/lib/message-content";

type MessageContentProps = {
  content: string | null;
  url: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mimeType?: string | null;
  compact?: boolean;
};

const providerStyles: Record<LinkProvider, string> = {
  github: "border-slate-400/35 bg-slate-500/[0.08]",
  youtube: "border-red-500/30 bg-red-500/[0.07]",
  twitter: "border-sky-500/30 bg-sky-500/[0.07]",
  generic: "border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.07)]",
};

function ProviderIcon({ provider }: { provider: LinkProvider }) {
  if (provider === "github") {
    return <Github className="size-4" />;
  }
  if (provider === "youtube") {
    return <Youtube className="size-4" />;
  }
  if (provider === "twitter") {
    return <AtSign className="size-4" />;
  }
  return <Globe2 className="size-4" />;
}

function LinkPreview({ link, compact }: { link: MessageLink; compact: boolean }) {
  const [isCopied, setIsCopied] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    if (!isCopied) {
      return;
    }
    const timeout = window.setTimeout(() => setIsCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [isCopied]);

  function stopCardInteraction(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  async function copyLink(event: MouseEvent<HTMLButtonElement>) {
    stopCardInteraction(event);
    if (navigator.clipboard === undefined) {
      return;
    }
    await navigator.clipboard.writeText(link.url);
    setIsCopied(true);
  }

  const thumbnailUrl = link.youtubeVideoId === null
    ? null
    : `https://i.ytimg.com/vi/${link.youtubeVideoId}/hqdefault.jpg`;

  return (
    <div className={`overflow-hidden rounded-xl border ${providerStyles[link.provider]}`} data-provider={link.provider}>
      {thumbnailUrl !== null && !thumbnailFailed ? (
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          onClick={stopCardInteraction}
          onMouseDown={stopCardInteraction}
          className={`group/thumbnail relative block overflow-hidden bg-slate-950 ${compact ? "aspect-[16/7]" : "aspect-video"}`}
          aria-label="Open YouTube video"
        >
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbnailFailed(true)}
            className="size-full object-cover opacity-90 transition duration-200 group-hover/thumbnail:scale-[1.02] group-hover/thumbnail:opacity-100"
          />
          <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/45 via-transparent to-transparent">
            <span className="grid size-11 place-items-center rounded-full bg-red-600 text-white shadow-xl">
              <Play className="ml-0.5 size-5 fill-current" />
            </span>
          </span>
        </a>
      ) : null}

      {thumbnailUrl !== null && thumbnailFailed ? (
        <div className={`grid place-items-center bg-slate-950 px-4 text-center text-xs font-medium text-white/70 ${compact ? "aspect-[16/7]" : "aspect-video"}`}>
          Thumbnail unavailable. You can still open the video below.
        </div>
      ) : null}

      <div className="flex min-w-0 items-start gap-3 p-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--background)/0.85)] text-[hsl(var(--foreground))] shadow-sm">
          <ProviderIcon provider={link.provider} />
        </span>
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          onClick={stopCardInteraction}
          onMouseDown={stopCardInteraction}
          className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            {link.providerLabel}
            <ExternalLink className="size-3" />
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-[hsl(var(--foreground))]">{link.title}</span>
          <span className="mt-0.5 block truncate text-xs text-[hsl(var(--muted-foreground))]">{link.description}</span>
        </a>
        <button
          type="button"
          draggable={false}
          onClick={(event) => void copyLink(event)}
          onMouseDown={stopCardInteraction}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--background)/0.85)] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={isCopied ? "Link copied" : "Copy link"}
          title={isCopied ? "Copied" : "Copy link"}
        >
          {isCopied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function isImageMessage(mediaType: string | null | undefined, mimeType: string | null | undefined): boolean {
  const normalizedMediaType = mediaType?.trim().toLowerCase() ?? "";
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  return normalizedMediaType.includes("photo")
    || normalizedMediaType.includes("image")
    || normalizedMimeType.startsWith("image/");
}

function isAudioMessage(mediaType: string | null | undefined, mimeType: string | null | undefined): boolean {
  const normalizedMediaType = mediaType?.trim().toLowerCase() ?? "";
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  return normalizedMediaType.includes("audio")
    || normalizedMediaType.includes("voice")
    || normalizedMimeType.startsWith("audio/");
}

function MessageAudio({ mediaUrl }: { mediaUrl: string }) {
  return (
    <audio
      src={mediaUrl}
      controls
      preload="metadata"
      aria-label="Play saved audio"
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      className="w-full max-w-xl"
    />
  );
}

function MessageImage({
  mediaUrl,
  compact,
  content,
}: {
  mediaUrl: string;
  compact: boolean;
  content: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [mediaUrl]);

  if (failed) {
    return (
      <p className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Image preview unavailable.
      </p>
    );
  }

  const alternativeText = content?.trim() ? `Saved Telegram image: ${content.trim()}` : "Saved Telegram image";
  return (
    <a
      href={mediaUrl}
      target="_blank"
      rel="noreferrer"
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      className={`block overflow-hidden rounded-xl bg-[hsl(var(--muted))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${compact ? "max-h-64" : "max-h-[70vh]"}`}
      aria-label="Open saved image"
    >
      <img
        src={mediaUrl}
        alt={alternativeText}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`w-full object-contain ${compact ? "max-h-64" : "max-h-[70vh]"}`}
      />
    </a>
  );
}

function LinkedText({ text, compact }: { text: string; compact: boolean }) {
  return (
    <p
      className={`whitespace-pre-wrap break-words text-sm leading-6 text-[hsl(var(--foreground))] ${compact ? "line-clamp-4" : ""}`}
      style={{ overflowWrap: "anywhere" }}
    >
      {messageTextParts(text).map((part, index) => part.url === null ? (
        part.value
      ) : (
        <a
          key={`${part.url}-${index}`}
          href={part.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          className="font-medium text-[hsl(var(--primary))] underline decoration-[hsl(var(--primary)/0.35)] underline-offset-2 hover:decoration-[hsl(var(--primary))]"
        >
          {part.value}
        </a>
      ))}
    </p>
  );
}

function compactTextWithoutPreviewedUrl(text: string, previewUrl: string): string | null {
  const compactText = messageTextParts(text)
    .filter((part) => part.url !== previewUrl)
    .map((part) => part.value)
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return compactText.length > 0 ? compactText : null;
}

export function MessageContent({
  content,
  url,
  mediaUrl = null,
  mediaType = null,
  mimeType = null,
  compact = false,
}: MessageContentProps) {
  const analysis = analyzeMessageContent(content, url);
  const imageMessage = isImageMessage(mediaType, mimeType);
  const audioMessage = isAudioMessage(mediaType, mimeType);
  const displayedText = analysis.text !== null && compact && analysis.link !== null
    ? compactTextWithoutPreviewedUrl(analysis.text, analysis.link.url)
    : analysis.text;

  return (
    <div className="space-y-3">
      {mediaUrl !== null && imageMessage
        ? <MessageImage mediaUrl={mediaUrl} compact={compact} content={analysis.text} />
        : null}
      {mediaUrl !== null && audioMessage ? <MessageAudio mediaUrl={mediaUrl} /> : null}
      {displayedText !== null ? <LinkedText text={displayedText} compact={compact} /> : null}
      {analysis.link !== null ? <LinkPreview key={analysis.link.url} link={analysis.link} compact={compact} /> : null}
      {analysis.text === null && analysis.link === null && mediaUrl === null ? (
        <p className="text-sm italic text-[hsl(var(--muted-foreground))]">
          {imageMessage
            ? "Image preview will be cached during the next scan."
            : audioMessage
              ? "Audio will be cached during the next scan."
              : "No text or link content on this message."}
        </p>
      ) : null}
    </div>
  );
}
