export const SYNC_TAG = "heirly-action-sync";

export const MSG_REGISTER_SYNC = "heirly/register-sync";
export const MSG_REPLAY_QUEUE = "heirly/replay-queue";
export const MSG_SYNC_STATUS = "heirly/sync-status";

export interface HeirlyWorkerMessage {
  type: string;
  supported?: boolean;
}
