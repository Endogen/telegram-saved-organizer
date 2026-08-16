export type MessageCategory = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
};

export type MessageTag = {
  id: number;
  name: string;
  color: string | null;
};

export type MessageListItem = {
  id: number;
  telegram_id: number;
  content: string | null;
  media_type: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  media_url: string | null;
  url: string | null;
  sender_name: string | null;
  date: string;
  category_id: number;
  raw_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  category: MessageCategory;
  tags: MessageTag[];
};

export type MessageListResponse = {
  items: MessageListItem[];
  total: number;
  page: number;
  per_page: number;
};
