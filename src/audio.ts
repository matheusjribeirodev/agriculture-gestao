import { GoogleGenAI } from "@google/genai";
import { registrarUsoIA } from "./db";
import { estimarCusto } from "./ai/custo";

export const DURACAO_MAXIMA_SEGUNDOS = 180;

export function duracaoValida(segundos: number | null | undefined): boolean {
  return segundos == null || segundos <= DURACAO_MAXIMA_SEGUNDOS;
}

let client: GoogleGenAI | null = null;

function obterClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Defina GEMINI_API_KEY no arquivo .env");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// Transcrição via Gemini (entende áudio nativamente, inclusive OGG/Opus — o
// formato que o WhatsApp usa para mensagens de voz — sem precisar decodificar
// localmente). Evita manter um modelo Whisper carregado em memória, o que
// importa em VMs pequenas (ex: 1GB de RAM no Oracle Free Tier).
export async function transcreverAudio(buffer: Buffer, mimeTypeOriginal?: string | null): Promise<string> {
  const modelo = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const mimeType = (mimeTypeOriginal ?? "audio/ogg").split(";")[0].trim();

  const resposta = await obterClient().models.generateContent({
    model: modelo,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: buffer.toString("base64") } },
          {
            text: "Transcreva o áudio acima literalmente, em português. Responda APENAS com o texto transcrito, sem comentários, sem aspas. Se o áudio não tiver fala compreensível, responda com uma string vazia.",
          },
        ],
      },
    ],
  });

  const uso = resposta.usageMetadata;
  if (uso) {
    const tokensInput = uso.promptTokenCount ?? 0;
    const tokensOutput = (uso.candidatesTokenCount ?? 0) + (uso.thoughtsTokenCount ?? 0);
    await registrarUsoIA({
      provider: "gemini",
      modelo,
      tokensInput,
      tokensOutput,
      custoEstimado: estimarCusto("gemini", tokensInput, tokensOutput),
    });
  }

  return (resposta.text ?? "").trim();
}
