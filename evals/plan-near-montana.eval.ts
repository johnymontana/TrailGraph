import { defineEval } from 'eve/evals';

/**
 * D1/§5: Casey asks for a short, ranked list. The ranger should answer with real, nearby parks and
 * not write memory on a pure discovery ask. Requires seeded/synced data + AI Gateway → run with
 * `pnpm agent:eval` against a running agent, not the no-creds CI unit job.
 */
export default defineEval({
  async test(t) {
    await t.send({ message: 'I have 4 days and want mountains and easy hikes near Montana. Suggest a few parks.' });
    await t.completed();
    await t.notCalledTool('save_preference'); // discovery, not a preference write
    await t.messageIncludes(/glacier|yellowstone/i); // real MT-area parks (graph-grounded)
  },
});
