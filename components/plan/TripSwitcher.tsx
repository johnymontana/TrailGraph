'use client';
import { useState } from 'react';
import { Button, Flex, HStack, Input, Icon, Menu, Portal } from '@chakra-ui/react';
import { LuChevronDown } from 'react-icons/lu';
import { decodeEntities } from '../../lib/html-entities';
import { useTripBuilder } from './useTripBuilder';

/** How many trips render as flat chips before the switcher collapses into a Menu (F9: the chip row used
 * to wrap and eat the pane once a user had a handful of trips). */
const CHIP_LIMIT = 6;

/**
 * Create-a-trip input + the open-trip switcher. Chips up to CHIP_LIMIT trips; beyond that, a Menu keyed
 * by the same accessible names (`{name} ({stops})`) so the e2e chip selectors keep working for small
 * fixtures while real accounts stop losing the pane to wrapping chips.
 */
export function TripSwitcher() {
  const { trips, trip, openingId, openTrip, create } = useTripBuilder();
  const [newName, setNewName] = useState('');

  async function handleCreate() {
    if (!newName.trim()) return;
    const name = newName;
    setNewName('');
    await create(name);
  }

  return (
    <>
      <Flex gap={2}>
        {/* fontSize ≥16px on base: iOS Safari auto-zooms any focused input below 16px (same on every input here). */}
        <Input size="sm" fontSize={{ base: 'md', md: 'sm' }} placeholder="New trip name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        <Button size="sm" minH={{ base: '10', md: '8' }} onClick={handleCreate} colorPalette="pine">Create</Button>
      </Flex>
      {trips.length > CHIP_LIMIT ? (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" alignSelf="start" loading={openingId != null}>
              {trip ? decodeEntities(trip.name) : `Your trips (${trips.length})`}
              <Icon boxSize={3.5}><LuChevronDown /></Icon>
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content maxH="60vh" overflowY="auto">
                {trips.map((t) => (
                  <Menu.Item key={t.id} value={t.id} onClick={() => openTrip(t.id)}>
                    {decodeEntities(t.name)} ({t.stops})
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      ) : (
        <HStack wrap="wrap">
          {trips.map((t) => (
            <Button
              key={t.id}
              size="xs"
              minH={{ base: '9', md: '6' }}
              variant={trip?.id === t.id ? 'solid' : 'outline'}
              loading={openingId === t.id}
              onClick={() => openTrip(t.id)}
            >
              {decodeEntities(t.name)} ({t.stops})
            </Button>
          ))}
        </HStack>
      )}
    </>
  );
}
