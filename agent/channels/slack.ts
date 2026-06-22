import { slackChannel } from 'eve/channels/slack';

/**
 * Later-phase Slack channel (Phase 4): "plan a trip with the ranger" inside team workspaces (e.g.
 * outdoor clubs) — no agent rewrite, same tools/skills. Reads SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET
 * from env; inert until those are configured, so it's safe to ship before Slack is wired.
 */
export default slackChannel({});
