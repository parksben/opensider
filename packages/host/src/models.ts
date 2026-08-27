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
  const model = options?.find((option) => {
    const id = `${option.id ?? ""} ${(option as { configId?: string }).configId ?? ""}`.toLowerCase();
    return option.category === "model" || id.includes("model");
  });
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
    modelConfigId: model.id || (model as { configId?: string }).configId || "model",
  };
}

export function catalogFromSessionModels(models: unknown): Partial<ModelCatalog> {
  if (!models || typeof models !== "object") return {};
  const rec = models as {
    currentModelId?: string;
    availableModels?: Array<{ modelId?: string; id?: string; name?: string }>;
  };
  const mapped = uniqueModels(
    (rec.availableModels ?? [])
      .map((item) => {
        const id = item.modelId || item.id || "";
        return { id, name: item.name || id };
      })
      .filter((item) => item.id),
  );
  return {
    models: mapped.length > 0 ? mapped : undefined,
    currentId: rec.currentModelId,
  };
}

const COPILOT_FALLBACK_MODELS: AgentModel[] = [
  { id: "auto", name: "Auto" },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
  { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  { id: "claude-opus-4.6-fast", name: "Claude Opus 4.6 Fast" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  { id: "gpt-5.5", name: "GPT-5.5" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
  { id: "gpt-5-mini", name: "GPT-5 Mini" },
];

export function copilotFallbackCatalog(): ModelCatalog {
  return {
    models: COPILOT_FALLBACK_MODELS,
    currentId: "auto",
    modelConfigId: "model",
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
