import "server-only";

const DEFAULT_MODEL = "openai/gpt-5.6-sol";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

function gatewayToken(request: Request) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) return { token: apiKey, source: "api_key" as const };

  const oidc = request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;
  return oidc ? { token: oidc, source: "oidc" as const } : null;
}

export async function callAtlasGatewayStructured<T>(
  request: Request,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  const auth = gatewayToken(request);
  if (!auth) throw new Error("AI Gateway authentication is unavailable on this request.");

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ATLAS_AI_MODEL || DEFAULT_MODEL,
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
    throw new Error(`AI Gateway request failed (${response.status}, ${auth.source}): ${detail}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`AI Gateway returned no structured content (${auth.source}).`);
  return JSON.parse(content) as T;
}
