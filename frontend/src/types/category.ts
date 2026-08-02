export type Category = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  position: number;
  is_default: boolean;
};

export type CategoryWithCount = Category & {
  message_count: number;
};
