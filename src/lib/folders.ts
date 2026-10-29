export type FolderRow = { id: string; parentId: string | null; name: string };
export type FolderNode = FolderRow & { children: FolderNode[]; depth: number };

export function buildTree(rows: FolderRow[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(rows.map((r) => [r.id, { ...r, children: [], depth: 0 }]));
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (nodes: FolderNode[], depth: number) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const n of nodes) {
      n.depth = depth;
      sort(n.children, depth + 1);
    }
  };
  sort(roots, 0);
  return roots;
}

/** Depth-first list, handy for <select> options. */
export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

export function pathOf(rows: FolderRow[], id: string | null): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: string[] = [];
  let cursor = id ? byId.get(id) : undefined;
  while (cursor && out.length < 50) {
    out.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return out;
}

/** The folder and every folder below it. */
export function subtreeIds(rows: FolderRow[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const r of rows) if (r.parentId === out[i]) out.push(r.id);
  }
  return out;
}
