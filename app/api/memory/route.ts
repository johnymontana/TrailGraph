import { getUserId } from '../../../lib/session';
import { getUserMemory } from '../../../lib/memory-graph';
import { deletePreference, deleteConsidered, deleteAllConsidered, setPreferenceFeedback, setPreferenceWeight, recordPreference } from '../../../lib/bridges';

/** "Your memory" API (E3/E4). All actions userId-scoped from the session (R4). */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await getUserMemory(userId));
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json()) as {
    op: 'deletePreference' | 'deleteConsidered' | 'clearConsidered' | 'feedback' | 'addPreference' | 'setWeight';
    kind?: 'activity' | 'topic';
    name?: string;
    parkCode?: string;
    vote?: 'up' | 'down';
    category?: string;
    value?: string;
    weight?: number;
  };

  switch (body.op) {
    case 'setWeight':
      if (!body.kind || !body.name || body.weight == null)
        return Response.json({ error: 'kind/name/weight required' }, { status: 400 });
      await setPreferenceWeight(userId, body.kind, body.name, body.weight);
      break;
    case 'addPreference':
      if (!body.category || !body.value) return Response.json({ error: 'category/value required' }, { status: 400 });
      await recordPreference({ userId, category: body.category, value: body.value }); // NAMS + canonical bridge
      break;
    case 'clearConsidered':
      await deleteAllConsidered(userId);
      break;
    case 'deletePreference':
      if (!body.kind || !body.name) return Response.json({ error: 'kind/name required' }, { status: 400 });
      await deletePreference(userId, body.kind, body.name); // durable delete + tombstone (ADR-016)
      break;
    case 'deleteConsidered':
      if (!body.parkCode) return Response.json({ error: 'parkCode required' }, { status: 400 });
      await deleteConsidered(userId, body.parkCode);
      break;
    case 'feedback':
      if (!body.kind || !body.name || !body.vote)
        return Response.json({ error: 'kind/name/vote required' }, { status: 400 });
      await setPreferenceFeedback(userId, body.kind, body.name, body.vote);
      break;
    default:
      return Response.json({ error: 'unknown op' }, { status: 400 });
  }
  return Response.json(await getUserMemory(userId));
}
