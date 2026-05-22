export interface NormalizedSlackMessage {
  slackTeamId: string;
  slackChannelId: string;
  slackChannelName: string | null;
  slackMessageTs: string;
  slackThreadTs: string | null;
  authorSlackUserId: string | null;
  authorDisplayName: string | null;
  text: string | null;
  hasAttachments: boolean;
  messageType: 'message' | 'app_mention' | 'thread_reply';
  rawPayload: Record<string, unknown>;
}

export type SlackEventPayload =
  | { type: 'url_verification'; token: string; challenge: string }
  | {
      type: 'event_callback';
      team_id: string;
      api_app_id: string;
      event_id: string;
      event_time: number;
      event:
        | {
            type: 'message';
            subtype?: string;
            channel: string;
            channel_type?: string;
            user?: string;
            text?: string;
            ts: string;
            thread_ts?: string;
            files?: unknown[];
          }
        | {
            type: 'app_mention';
            user: string;
            text: string;
            ts: string;
            channel: string;
            thread_ts?: string;
          };
    };

export interface SlackSlashCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}
