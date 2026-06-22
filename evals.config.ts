import { defineEvalConfig } from 'eve/evals';

/** Judge model for `t.judge.*` assertions (scoring only — never the agent under test). */
export default defineEvalConfig({
  judge: { model: 'anthropic/claude-sonnet-4.6' },
});
