import "server-only";

const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const VERCEL_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

type AtlasModelProvider = "openai" | "openai_compatible" | "vercel_gateway";

type RuntimeConfig = {
  provider: AtlasModelProvider;
  model: string;
  endpoint: string;
  token: string;
  protocol: "openai_responses" | "openai_chat_completions";
};

export class AtlasModelUnavailableError extends Error {
  readonly code = "ATLAS_MODEL_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "AtlasModelUnavailableError";
  }
}

function clean(value: string | undefined | null) {
  return typeof value === "string" ? value.trim() : "";
}

function stripProviderPrefix(value: string) {
  return value.startsWith("openai/") ? value.slice("openai/".length) : value;
}

function gatewayToken(request: Request) {
  const apiKey = clean(process.env.AI_GATEWAY_API_KEY);
  if (apiKey) return apiKey;
  return clean(request.headers.get("x-vercel-oidc-token")) || clean(process.env.VERCEL_OIDC_TOKEN);
}

function selectedProvider() {
  const explicit = clean(process.env.ATLAS_MODEL_PROVIDER).toLowerCase();
  if (!explicit) return null;
  if (explicit === "openai" || explicit === "openai_compatible" || explicit === "vercel_gateway") {
    return explicit as AtlasModelProvider;
  }
  throw new AtlasModelUnavailableError(`Unsupported ATLAS_MODEL_PROVIDER: ${explicit}`);
}

function resolveRuntime(request: Request): RuntimeConfig {
  const explicit = selectedProvider();

  // Direct providers are the automatic path. Vercel Gateway is deliberately
  // opt-in so Atlas intelligence never depends on Vercel billing merely because
  // the application happens to be deployed on Vercel.
  const provider = explicit
    ?? (clean(process.env.OPENAI_API_KEY) ? "openai" : null)
    ?? (clean(process.env.ATLAS_MODEL_BASE_URL) && clean(process.env.ATLAS_MODEL_API_KEY)
      ? "openai_compatible"
      : null);

  if (!provider) {
    throw new AtlasModelUnavailableError(
      "No Atlas model provider is configured. Set OPENAI_API_KEY, configure an OpenAI-compatible provider, or explicitly select vercel_gateway.",
    );
  }

  if (provider === "openai") {
    const token = clean(process.env.OPENAI_API_KEY);
    if (!token) throw new AtlasModelUnavailableError("OPENAI_API_KEY is required for the direct OpenAI provider.");
    const configuredModel = clean(process.env.ATLAS_OPENAI_MODEL) || clean(process.env.ATLAS_AI_MODEL);
    return {
      provider,
      model: stripProviderPrefix(configuredModel || DEFAULT_OPENAI_MODEL),
      endpoint: OPENAI_RESPONSES_URL,
      token,
      protocol: "openai_responses",
    };
  }

  if (provider === "openai_compatible") {
    const baseUrl = clean(process.env.ATLAS_MODEL_BASE_URL).replace(/\/+$/, "");
    const token = clean(process.env.ATLAS_MODEL_API_KEY);
    const model = clean(process.env.ATLAS_MODEL_MODEL) || clean(process.env.ATLAS_AI_MODEL);
    if (!baseUrl || !token || !model) {
      throw new AtlasModelUnavailableError(
        "ATLAS_MODEL_BASE_URL, ATLAS_MODEL_API_KEY, and ATLAS_MODEL_MODEL are required for an OpenAI-compatible provider.",
      );
    }
    return {
      provider,
      model,
      endpoint: `${baseUrl}/chat/completions`,
      token,
      protocol: "openai_chat_completions",
    };
  }

  const token = gatewayToken(request);
  if (!token) throw new AtlasModelUnavailableError("Vercel Gateway was selected but no Gateway credential is available.");
  return {
    provider,
    model: clean(process.env.ATLAS_AI_MODEL) || `openai/${DEFAULT_OPENAI_MODEL}`,
    endpoint: VERCEL_GATEWAY_URL,
    token,
    protocol: "openai_chat_completions",
  };
}

function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: unknown; text?: unknown; refusal?: unknown };
      if (typed.type === "refusal" && typeof typed.refusal === "string") {
        throw new Error(`Atlas model refused the structured request: ${typed.refusal.slice(0, 240)}`);
      }
      if (typed.type === "output_text" && typeof typed.text === "string") return typed.text;
    }
  }
  return null;
}

async function callOpenAIResponses<T>(
  config: RuntimeConfig,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
      store: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`Atlas model provider ${config.provider} failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const content = responseOutputText(payload);
  if (!content) throw new Error(`Atlas model provider ${config.provider} returned no structured output.`);
  return JSON.parse(content) as T;
}

async function callOpenAICompatible<T>(
  config: RuntimeConfig,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema },
      },
      stream: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    throw new Error(`Atlas model provider ${config.provider} failed (${response.status}): ${detail}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Atlas model provider ${config.provider} returned no structured output.`);
  return JSON.parse(content) as T;
}

export function getAtlasModelRuntimeStatus(request: Request) {
  try {
    const config = resolveRuntime(request);
    return {
      configured: true,
      provider: config.provider,
      model: config.model,
      protocol: config.protocol,
    } as const;
  } catch (error) {
    return {
      configured: false,
      provider: null,
      model: null,
      protocol: null,
      reason: error instanceof Error ? error.message : "Atlas model runtime is unavailable.",
    } as const;
  }
}

export async function callAtlasStructured<T>(
  request: Request,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  const config = resolveRuntime(request);
  return config.protocol === "openai_responses"
    ? callOpenAIResponses<T>(config, name, schema, system, user)
    : callOpenAICompatible<T>(config, name, schema, system, user);
}
