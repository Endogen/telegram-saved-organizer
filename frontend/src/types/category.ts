export type Category = {
  id: number;
  name: string;
  slug: string;
  system_key: string | null;
  icon: string;
  color: string;
  position: number;
  is_default: boolean;
};

export type CategoryWithCount = Category & {
  message_count: number;
};
