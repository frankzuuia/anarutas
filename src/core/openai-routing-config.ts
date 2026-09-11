import { AppError } from "./errors";

type Env = Record<string, string | undefined>;

const reasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type OpenAIReasoningEffort = (typeof reasoningEfforts)[number];

export function readOpenAIRoutingConfig(env: Env = process.env) {
  const apiKey = env.RUTAS_OPENAI_API_KEY?.trim();
  const model = env.RUTAS_OPENAI_MODEL?.trim();
  if (!apiKey || !model) throw new AppError("ROUTING_AI_CONFIG_MISSING", 503);
  if (apiKey.length > 500 || model.length > 100)
    throw new AppError("ROUTING_AI_CONFIG_INVALID", 503);
  const organization = env.RUTAS_OPENAI_ORGANIZATION_ID?.trim() || null;
  const project = env.RUTAS_OPENAI_PROJECT_ID?.trim() || null;
  const rawReasoningEffort =
    env.RUTAS_OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  const reasoningEffort = rawReasoningEffort
    ? reasoningEfforts.find((value) => value === rawReasoningEffort)
    : null;
  if ((organization?.length ?? 0) > 200 || (project?.length ?? 0) > 200)
    throw new AppError("ROUTING_AI_CONFIG_INVALID", 503);
  if (rawReasoningEffort && !reasoningEffort)
    throw new AppError("ROUTING_AI_CONFIG_INVALID", 503);
  return { apiKey, model, organization, project, reasoningEffort };
}
