import { DefaultFileOptions } from '../../submission/default-options.interface';

export interface BlueskyFileOptions extends DefaultFileOptions {
  altText?: string;
  label_rating: string;
  replyToUrl?: string;
  threadgate?: string;
  randomMessageId?: string;
  replyMessage?: string;
  useReplyPost?: boolean;
  useRandomMessage?: boolean;
}
