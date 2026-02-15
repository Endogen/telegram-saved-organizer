export type ScanStatus = {
  is_running: boolean;
  is_complete: boolean;
  stop_requested: boolean;
  messages_scanned: number;
  pages_scanned: number;
  page_size: number;
  last_message_id: number | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};
