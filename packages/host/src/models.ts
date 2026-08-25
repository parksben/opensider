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

export function parseAgentModels(stdout: string): ModelCatalog {
  const models: AgentModel[] = [];
  let currentId = "auto";
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    const match = MODEL_LINE.exec(line);
    if (!match) continue;
    const id = match[1];
    let name = match[2];
    name = name.replace(/\s*\((?:default|current)\)/gi, "").trim() || id;
    models.push({ id, name });
    if (id === "auto") currentId = "auto";
  }
  if (models.length === 0) models.push({ id: "auto", name: "Auto" });
  if (!models.some((model) => model.id === currentId)) currentId = models[0].id;
  return { models, currentId, modelConfigId: "model" };
}

export function catalogFromConfigOptions(options: ConfigOption[] | undefined): Partial<ModelCatalog> {
  const model = options?.find((option) => option.category === "model" || option.id === "model");
  if (!model) return {};
  const models = (model.options ?? [])
    .filter((option) => option.value)
    .map((option) => ({ id: option.value, name: option.name || option.value }));
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
  const models = [...byId.values()];
  const currentId =
    overlay.currentId && models.some((model) => model.id === overlay.currentId)
      ? overlay.currentId
      : models.some((model) => model.id === base.currentId)
        ? base.currentId
        : (models[0]?.id ?? "auto");
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
