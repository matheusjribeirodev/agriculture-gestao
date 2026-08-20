import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  ChamadaFerramenta,
  FerramentaDef,
  ParametrosGerar,
  RespostaGeracao,
  TurnoConversa,
} from "./types";
import { registrarUsoIA } from "../db";
import { estimarCusto } from "./custo";

function paraFerramentaClaude(f: FerramentaDef): Anthropic.Tool {
  return { name: f.nome, description: f.descricao, input_schema: f.schema as Anthropic.Tool.InputSchema };
}

function paraMensagens(historico: TurnoConversa[], mensagem: string): Anthropic.MessageParam[] {
  const mensagens: Anthropic.MessageParam[] = historico.map((turno) => ({
    role: turno.autor === "produtor" ? "user" : "assistant",
    content: turno.texto,
  }));
  mensagens.push({ role: "user", content: mensagem });
  return mensagens;
}

function extrairTextBlock(content: Anthropic.ContentBlock[]): string | undefined {
  return content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
}

export class ClaudeProvider implements AIProvider {
  readonly nome = "claude";
  private client: Anthropic;
  private modelo: string;

  constructor(apiKey: string, modelo: string) {
    this.client = new Anthropic({ apiKey });
    this.modelo = modelo;
  }

  async gerar({ systemPrompt, historico, mensagem, ferramentas, rodadasAnteriores }: ParametrosGerar): Promise<RespostaGeracao> {
    const mensagens = paraMensagens(historico, mensagem);

    for (const rodada of rodadasAnteriores) {
      mensagens.push({ role: "assistant", content: rodada.brutoResposta as Anthropic.ContentBlock[] });
      mensagens.push({
        role: "user",
        content: rodada.chamadas.map(
          (chamada, i): Anthropic.ToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: chamada.idBruto!,
            content: JSON.stringify(rodada.resultados[i]),
          }),
        ),
      });
    }

    const resposta = await this.client.messages.create({
      model: this.modelo,
      max_tokens: 1024,
      system: systemPrompt,
      tools: ferramentas.map(paraFerramentaClaude),
      messages: mensagens,
    });

    registrarUsoIA({
      provider: this.nome,
      modelo: this.modelo,
      tokensInput: resposta.usage.input_tokens,
      tokensOutput: resposta.usage.output_tokens,
      custoEstimado: estimarCusto("claude", resposta.usage.input_tokens, resposta.usage.output_tokens),
    });

    const chamadas: ChamadaFerramenta[] = resposta.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ nome: b.name, input: b.input, idBruto: b.id }));

    if (chamadas.length > 0) {
      return { tipo: "chamadas", chamadas, brutoResposta: resposta.content };
    }
    return { tipo: "texto", texto: extrairTextBlock(resposta.content) ?? "" };
  }
}
