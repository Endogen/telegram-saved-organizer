import {
  Archive,
  Bookmark,
  Code2,
  FileText,
  Folder,
  FolderKanban,
  ImageIcon,
  Link2,
  MessageSquareText,
  Music2,
  type LucideIcon,
  Video,
} from "lucide-react";

export type CategoryIconChoice = {
  name: string;
  label: string;
  icon: LucideIcon;
};

export const CATEGORY_ICON_CHOICES: CategoryIconChoice[] = [
  { name: "message-square", label: "Text", icon: MessageSquareText },
  { name: "link", label: "Link", icon: Link2 },
  { name: "bookmark", label: "Bookmark", icon: Bookmark },
  { name: "folder", label: "Folder", icon: Folder },
  { name: "video", label: "Video", icon: Video },
  { name: "music", label: "Audio", icon: Music2 },
  { name: "image", label: "Image", icon: ImageIcon },
  { name: "file-text", label: "Document", icon: FileText },
  { name: "code", label: "Code", icon: Code2 },
  { name: "archive", label: "Archive", icon: Archive },
];

const categoryIconMap = Object.fromEntries(
  CATEGORY_ICON_CHOICES.map((choice) => [choice.name, choice.icon]),
) as Record<string, LucideIcon>;

export function resolveCategoryIcon(iconName: string): LucideIcon {
  return categoryIconMap[iconName.toLowerCase()] ?? FolderKanban;
}
