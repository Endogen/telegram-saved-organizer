export type ScanStatus = {
  job_id: string | null;
  state: "idle" | "pending" | "running" | "stopping" | "completed" | "failed" | "cancelled";
  stop_requested: boolean;
  messages_scanned: number;
  pages_scanned: number;
  page_size: number;
  max_messages: number | null;
  max_runtime_seconds: number | null;
  last_message_id: number | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  completion_reason:
    | "source_exhausted"
    | "message_limit_reached"
    | "runtime_limit_reached"
    | "stopped_by_user"
    | null;
};
