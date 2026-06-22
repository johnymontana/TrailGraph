'use client';
import { useState, type ReactNode } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';

/**
 * Per-request Emotion SSR registry (the canonical MUI/Emotion App-Router pattern). Chakra v3 renders
 * its theme styles via Emotion's `<Global>`, which otherwise emits an inline `<EmotionGlobal>` `<style>`
 * in the body — and that collides with next-themes' injected color-mode `<script>`, flipping their order
 * between server and client → "Hydration failed" on every navigation (QA R1–R4; the bundler switch did
 * NOT fix it because the collision is in the rendered tree, not the bundler).
 *
 * This registry moves ALL Emotion styles (incl. global) out of the React tree and flushes them as
 * `<style>` tags via `useServerInsertedHTML`, so there is nothing inline to collide with the theme
 * script. It tracks only names inserted *this pass* and never clears `cache.inserted` — so Emotion's
 * `registered` map stays in sync and class hashes match (the bug in the earlier `compat`+manual-flush
 * version was clearing that map).
 */
export function EmotionRegistry({ children }: { children: ReactNode }) {
  const [registry] = useState(() => {
    const cache = createCache({ key: 'css' });
    cache.compat = true;
    const prevInsert = cache.insert.bind(cache);
    let inserted: { name: string; isGlobal: boolean }[] = [];
    cache.insert = (...args: Parameters<typeof prevInsert>) => {
      const serialized = args[1];
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push({ name: serialized.name, isGlobal: !args[0] }); // global styles use an empty selector
      }
      return prevInsert(...args);
    };
    const flush = () => {
      const prev = inserted;
      inserted = [];
      return prev;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const inserted = registry.flush();
    if (inserted.length === 0) return null;
    let styles = '';
    let dataEmotionAttribute = registry.cache.key;
    const globals: { name: string; style: string }[] = [];
    for (const { name, isGlobal } of inserted) {
      const style = registry.cache.inserted[name];
      if (typeof style !== 'string') continue;
      if (isGlobal) globals.push({ name, style });
      else {
        styles += style;
        dataEmotionAttribute += ` ${name}`;
      }
    }
    return (
      <>
        {globals.map(({ name, style }) => (
          // eslint-disable-next-line react/no-danger
          <style key={name} data-emotion={`${registry.cache.key}-global ${name}`} dangerouslySetInnerHTML={{ __html: style }} />
        ))}
        {styles ? (
          // eslint-disable-next-line react/no-danger
          <style data-emotion={dataEmotionAttribute} dangerouslySetInnerHTML={{ __html: styles }} />
        ) : null}
      </>
    );
  });

  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}
