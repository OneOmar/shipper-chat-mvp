import type { MessageRole } from "@prisma/client";

type ChatMessage = { role: MessageRole; content: string };

/**
 * NOTE:
 * Do NOT snapshot env vars at import time.
 * The standalone socket-server loads dotenv at runtime and may import this module before env is loaded,
 * which would make AI calls fail even when the env var exists.
 */
function getOpenAIKey() {
  return process.env.OPENAI_API_KEY ?? "";
}

function getOpenAIModel() {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

function assertOpenAIKey() {
  if (!getOpenAIKey()) throw new Error("Missing OPENAI_API_KEY");
}

export async function getAssistantReplyText(messages: ChatMessage[]): Promise<string> {
  assertOpenAIKey();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ],
      temperature: 0.7
    })
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function streamAssistantReply(
  messages: ChatMessage[],
  onDelta: (delta: string, full: string) => void
): Promise<string> {
  assertOpenAIKey();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      stream: true,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ],
      temperature: 0.7
    })
  });

  if (!res.ok || !res.body) throw new Error(`OpenAI error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE frames: lines like "data: {...}\n\n"
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return full.trim();
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            onDelta(delta, full);
          }
        } catch {
          // ignore invalid frames
        }
      }
    }
  }

  return full.trim();
}


