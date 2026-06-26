'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeedGraph, SeedNode, SeedLink } from '../../lib/graph-nvl';

/**
 * Client-side explorer dataset for /graph (#2): the seed graph plus on-demand expansions. Expand fetches
 * a node's one-hop neighbours and grows the dataset (the NVL wrapper diffs props → `addAndUpdate…`, which
 * retains positions); double-click collapses with REF-COUNTING so a node reachable from two expanded
 * centres doesn't vanish when only one collapses. Seed nodes/links are never removed. Pure logic kept in
 * the reducer-ish callbacks; the `fetcher` is injectable for tests.
 */

const linkKey = (l: SeedLink) => `${l.source}--${l.target}`;

export type ExpandFetcher = (key: string, label: string) => Promise<{ nodes: SeedNode[]; links: SeedLink[] }>;

const defaultFetcher: ExpandFetcher = async (key, label) => {
  const res = await fetch(`/api/graph/expand?key=${encodeURIComponent(key)}&label=${encodeURIComponent(label)}`);
  if (!res.ok) throw new Error(`expand failed: ${res.status}`);
  return res.json();
};

export interface GraphExplorer {
  nodes: SeedNode[];
  links: SeedLink[];
  expanded: Set<string>;
  loadingId: string | null;
  expand: (node: SeedNode) => void;
  collapse: (nodeId: string) => void;
  reset: () => void;
}

export function useGraphExplorer(seed: SeedGraph, fetcher: ExpandFetcher = defaultFetcher): GraphExplorer {
  const [nodes, setNodes] = useState<Map<string, SeedNode>>(() => new Map(seed.nodes.map((n) => [n.id, n])));
  const [links, setLinks] = useState<Map<string, SeedLink>>(() => new Map(seed.links.map((l) => [linkKey(l), l])));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const seedNodeIds = useRef<Set<string>>(new Set(seed.nodes.map((n) => n.id)));
  const seedLinkKeys = useRef<Set<string>>(new Set(seed.links.map(linkKey)));
  const nodeRef = useRef<Map<string, number>>(new Map());
  const linkRef = useRef<Map<string, number>>(new Map());
  const contributions = useRef<Map<string, { nodes: string[]; links: string[] }>>(new Map());

  // Re-seed when the RSC payload changes (e.g. navigating to /graph?topic=…).
  const seedSig = `${seed.nodes.length}:${seed.links.length}:${seed.nodes[0]?.id ?? ''}`;
  useEffect(() => {
    setNodes(new Map(seed.nodes.map((n) => [n.id, n])));
    setLinks(new Map(seed.links.map((l) => [linkKey(l), l])));
    setExpanded(new Set());
    setLoadingId(null);
    seedNodeIds.current = new Set(seed.nodes.map((n) => n.id));
    seedLinkKeys.current = new Set(seed.links.map(linkKey));
    nodeRef.current = new Map();
    linkRef.current = new Map();
    contributions.current = new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSig]);

  const expand = useCallback(
    (node: SeedNode) => {
      if (expanded.has(node.id) || loadingId) return;
      setLoadingId(node.id);
      fetcher(node.key, node.label)
        .then(({ nodes: ns, links: ls }) => {
          setNodes((prev) => {
            const next = new Map(prev);
            for (const n of ns) if (!next.has(n.id)) next.set(n.id, n);
            return next;
          });
          setLinks((prev) => {
            const next = new Map(prev);
            for (const l of ls) {
              const k = linkKey(l);
              if (!next.has(k)) next.set(k, l);
            }
            return next;
          });
          const contribNodes: string[] = [];
          const contribLinks: string[] = [];
          for (const n of ns)
            if (!seedNodeIds.current.has(n.id)) {
              nodeRef.current.set(n.id, (nodeRef.current.get(n.id) ?? 0) + 1);
              contribNodes.push(n.id);
            }
          for (const l of ls) {
            const k = linkKey(l);
            if (!seedLinkKeys.current.has(k)) {
              linkRef.current.set(k, (linkRef.current.get(k) ?? 0) + 1);
              contribLinks.push(k);
            }
          }
          contributions.current.set(node.id, { nodes: contribNodes, links: contribLinks });
          setExpanded((prev) => new Set(prev).add(node.id));
        })
        .catch(() => {})
        .finally(() => setLoadingId(null));
    },
    [expanded, loadingId, fetcher],
  );

  const collapse = useCallback((nodeId: string) => {
    const contrib = contributions.current.get(nodeId);
    if (!contrib) return;
    const removeNodes = new Set<string>();
    const removeLinks = new Set<string>();
    for (const id of contrib.nodes) {
      const c = (nodeRef.current.get(id) ?? 0) - 1;
      if (c <= 0) {
        nodeRef.current.delete(id);
        removeNodes.add(id);
      } else nodeRef.current.set(id, c);
    }
    for (const k of contrib.links) {
      const c = (linkRef.current.get(k) ?? 0) - 1;
      if (c <= 0) {
        linkRef.current.delete(k);
        removeLinks.add(k);
      } else linkRef.current.set(k, c);
    }
    setNodes((prev) => {
      const next = new Map(prev);
      for (const id of removeNodes) next.delete(id);
      return next;
    });
    setLinks((prev) => {
      const next = new Map(prev);
      for (const k of removeLinks) next.delete(k);
      // prune any surviving link whose endpoint was removed (no dangling edges)
      for (const [k, l] of next) if (removeNodes.has(l.source) || removeNodes.has(l.target)) next.delete(k);
      return next;
    });
    contributions.current.delete(nodeId);
    setExpanded((prev) => {
      const n = new Set(prev);
      n.delete(nodeId);
      return n;
    });
  }, []);

  const reset = useCallback(() => {
    setNodes(new Map(seed.nodes.map((n) => [n.id, n])));
    setLinks(new Map(seed.links.map((l) => [linkKey(l), l])));
    setExpanded(new Set());
    nodeRef.current = new Map();
    linkRef.current = new Map();
    contributions.current = new Map();
  }, [seed]);

  const nodeArr = useMemo(() => Array.from(nodes.values()), [nodes]);
  const linkArr = useMemo(() => Array.from(links.values()), [links]);

  return { nodes: nodeArr, links: linkArr, expanded, loadingId, expand, collapse, reset };
}
