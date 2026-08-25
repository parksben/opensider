import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentModel } from "../../shared/src/protocol.ts";

const execFileAsync = promisify(execFile);

export type ConfigOption = {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: unknown;
  options?: Array<{ value: string; name: string }>;
};

export type ModelCatalog = {
  models: AgentModel[];
  currentId: string;
  modelConfigId: string;
};

const MODEL_LINE = /^(\S+)\s+-\s+(.+)$/;

export function isUnsetModel(id: string | undefined): boolean {
  return !id || id === "auto";
}

export function uniqueModels(models: AgentModel[]): AgentModel[] {
  const byId = new Map<string, AgentModel>();
  for (const model of models) {
    if (!model.id) continue;
    byId.set(model.id, model);
  }
  return [...byId.values()];
}

export function parseAgentModels(stdout: string): ModelCatalog {
  const models: AgentModel[] = [];
  let markedCurrent = "";
  let markedDefault = "";
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    const match = MODEL_LINE.exec(line);
    if (!match) continue;
    const id = match[1];
    const rawName = match[2];
    if (/\(current\)/i.test(rawName)) markedCurrent = id;
    else if (/\(default\)/i.test(rawName)) markedDefault = id;
    const name = rawName.replace(/\s*\((?:default|current)\)/gi, "").trim() || id;
    models.push({ id, name });
  }
  const unique = uniqueModels(models);
  const currentId =
    unique.find((model) => model.id === "auto")?.id ||
    (markedCurrent && unique.some((model) => model.id === markedCurrent) ? markedCurrent : "") ||
    (markedDefault && unique.some((model) => model.id === markedDefault) ? markedDefault : "") ||
    unique[0]?.id ||
    "";
  return { models: unique, currentId, modelConfigId: "model" };
}

export function catalogFromConfigOptions(options: ConfigOption[] | undefined): Partial<ModelCatalog> {
  const model = options?.find((option) => option.category === "model" || option.id === "model");
  if (!model) return {};
  const models = uniqueModels(
    (model.options ?? [])
      .filter((option) => option.value)
      .map((option) => ({ id: option.value, name: option.name || option.value })),
  );
  const currentId = typeof model.currentValue === "string" ? model.currentValue : undefined;
  return {
    models: models.length > 0 ? models : undefined,
    currentId,
    modelConfigId: model.id || "model",
  };
}

export function mergeCatalog(base: ModelCatalog, overlay: Partial<ModelCatalog>): ModelCatalog {
  const byId = new Map(base.models.map((model) => [model.id, model]));
  for (const model of overlay.models ?? []) byId.set(model.id, model);
  const models = uniqueModels([...byId.values()]);
  const currentId =
    overlay.currentId && models.some((model) => model.id === overlay.currentId)
      ? overlay.currentId
      : models.some((model) => model.id === base.currentId)
        ? base.currentId
        : (models[0]?.id ?? "");
  return {
    models,
    currentId,
    modelConfigId: overlay.modelConfigId || base.modelConfigId,
  };
}

export async function listAgentModels(agentPath: string): Promise<ModelCatalog> {
  const { stdout } = await execFileAsync(agentPath, ["models"], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return parseAgentModels(stdout);
}
