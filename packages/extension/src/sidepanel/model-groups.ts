/** One heading in the model menu. An empty label means the models have no `group/name` prefix. */
export type ModelGroup<T> = {
  label: string;
  items: T[];
};

/**
 * Split `Provider/Model` names into a group heading and a short label.
 * The first slash is the boundary; anything after it stays in the item so
 * `OpenCode Zen/Ling 3.0 Flash` shows as group "OpenCode Zen" and item "Ling 3.0 Flash".
 * Names without a slash stay ungrouped and keep their full text.
 */
export function groupModelsByPrefix<T extends { name: string }>(models: T[]): ModelGroup<T>[] {
  const groups: ModelGroup<T>[] = [];
  const byLabel = new Map<string, ModelGroup<T>>();
  for (const model of models) {
    const label = modelGroupLabel(model.name);
    let group = byLabel.get(label);
    if (!group) {
      group = { label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(model);
  }
  return groups;
}

export function modelGroupLabel(name: string): string {
  const slash = name.indexOf("/");
  if (slash <= 0) return "";
  return name.slice(0, slash).trim();
}

export function modelShortName(name: string): string {
  const slash = name.indexOf("/");
  if (slash <= 0) return name;
  const rest = name.slice(slash + 1).trim();
  return rest || name;
}
