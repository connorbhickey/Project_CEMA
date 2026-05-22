import { WebClient } from '@slack/web-api';

export function getSlackClient(botToken: string): WebClient {
  return new WebClient(botToken);
}

export async function fetchSlackUserDisplayName(
  client: WebClient,
  userId: string,
): Promise<string | null> {
  const res = await client.users.info({ user: userId });
  if (!res.ok || !res.user) return null;
  const profile = (res.user as { profile?: { display_name?: string }; real_name?: string }).profile;
  return profile?.display_name || (res.user as { real_name?: string }).real_name || null;
}

export interface PostEphemeralReplyParams {
  channel: string;
  user: string;
  text: string;
}

export async function postEphemeralReply(
  client: WebClient,
  params: PostEphemeralReplyParams,
): Promise<void> {
  await client.chat.postEphemeral({
    channel: params.channel,
    user: params.user,
    text: params.text,
  });
}
