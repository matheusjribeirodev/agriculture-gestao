import { AIRouter } from "./ai/router";
import { GeminiProvider } from "./ai/gemini-provider";
import { ClaudeProvider } from "./ai/claude-provider";
import type { TurnoConversa } from "./ai/types";
import type { ProjetoDef } from "./projects/types";

export interface TrocaAnterior {
  perguntaProdutor: string;
  respostaBot: string;
}

export type ResultadoInterpretacao =
  | { tipo: "registrar"; dados: Record<string, unknown> }
  | { tipo: "gerar_pdf"; offsetMeses: number; extra?: Record<string, unknown> }
  // `resolvida` diferencia uma resposta com dados reais (uma ferramenta foi
  // executada) de uma resposta conversacional/pergunta de esclarecimento
  // (nenhuma ferramenta foi chamada) — usado para decidir se vale a pena
  // lembrar essa troca para a próxima mensagem (ver TrocaAnterior).
  | { tipo: "resposta"; texto: string; resolvida: boolean };

function criarRouter(): AIRouter {
  const geminiKey = process.env.GEMINI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey) throw new Error("Defina GEMINI_API_KEY no arquivo .env");
  if (!claudeKey) throw new Error("Defina ANTHROPIC_API_KEY no arquivo .env");

  const gemini = new GeminiProvider(geminiKey, process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
  const claude = new ClaudeProvider(claudeKey, process.env.CLAUDE_MODEL || "claude-opus-5");
  return new AIRouter(gemini, claude);
}

// Um router só, compartilhado entre todos os projetos — ele não sabe qual
// projeto está ativo, só recebe o prompt/ferramentas certos a cada chamada.
const router = criarRouter();

export async function interpretarMensagem(
  texto: string,
  projeto: ProjetoDef,
  trocaAnterior?: TrocaAnterior,
): Promise<ResultadoInterpretacao> {
  const historico: TurnoConversa[] = trocaAnterior
    ? [
        { autor: "produtor", texto: trocaAnterior.perguntaProdutor },
        { autor: "bot", texto: trocaAnterior.respostaBot },
      ]
    : [];

  const resultado = await router.interpretar(
    {
      systemPrompt: projeto.systemPrompt,
      historico,
      mensagem: texto,
      ferramentas: projeto.ferramentas,
      nomeFerramentaRegistrar: projeto.nomeFerramentaRegistrar,
      nomeFerramentaPdf: projeto.nomeFerramentaPdf,
    },
    projeto.executarFerramenta,
  );

  if (resultado.tipo === "registrar") {
    const dados = projeto.parseRegistro(resultado.chamada.input);
    return { tipo: "registrar", dados };
  }

  if (resultado.tipo === "gerar_pdf") {
    const { offsetMeses, extra } = projeto.parseArgumentosPdf(resultado.chamada.input);
    return { tipo: "gerar_pdf", offsetMeses, extra };
  }

  return {
    tipo: "resposta",
    texto: resultado.texto || "Não consegui gerar uma resposta.",
    resolvida: resultado.teveFerramentas,
  };
}
