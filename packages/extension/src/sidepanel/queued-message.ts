import type { AttachmentItem } from "@shared";

export type QueuedMessage = {
  id: string;
  text: string;
  attachments: AttachmentItem[];
};
