import { redirect } from 'next/navigation';
import { getServerUserId } from '../../lib/session';
import { getUserMemory } from '../../lib/memory-graph';
import { OnboardingClient } from './OnboardingClient';

/**
 * Preference seed (ADR-038). Two ways in:
 *  - the magic-link callback (`?welcome=1`) lands new users here — but a returning user who already has
 *    preferences is bounced straight to /explore so sign-in doesn't dead-end on a seed screen;
 *  - the account menu's "Edit preferences" (bare `/onboarding`) always shows the picker so anyone can
 *    add more interests (full edit/remove lives on /me).
 * Signed-out visitors are sent to sign in either way.
 */
export const dynamic = 'force-dynamic';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const userId = await getServerUserId();
  if (!userId) redirect('/signin');
  const { welcome } = await searchParams;
  if (welcome) {
    const memory = await getUserMemory(userId).catch(() => null);
    if (memory && memory.preferences.length > 0) redirect('/explore');
  }
  return <OnboardingClient />;
}
