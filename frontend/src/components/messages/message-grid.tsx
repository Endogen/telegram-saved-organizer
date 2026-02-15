import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { MessageCard } from "@/components/messages/message-card";
import type { MessageListItem } from "@/types/message";

type MessageGridProps = {
  messages: MessageListItem[];
  pendingDeleteMessageId: number | null;
  onMoveRequest: (message: MessageListItem) => void;
  onTagRequest: (message: MessageListItem) => void;
  onDeleteRequest: (message: MessageListItem) => void;
};

export function MessageGrid({
  messages,
  pendingDeleteMessageId,
  onMoveRequest,
  onTagRequest,
  onDeleteRequest,
}: MessageGridProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      layout
      transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", bounce: 0.18, duration: 0.34 }}
      className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
    >
      <AnimatePresence initial={!shouldReduceMotion} mode="popLayout">
        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            isDeletePending={pendingDeleteMessageId === message.id}
            onMoveRequest={onMoveRequest}
            onTagRequest={onTagRequest}
            onDeleteRequest={onDeleteRequest}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
