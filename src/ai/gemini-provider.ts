import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
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

function paraFerramentaGemini(f: FerramentaDef): FunctionDeclaration {
  return { name: f.nome, description: f.descricao, parametersJsonSchema: f.schema };
}

function paraContents(historico: TurnoConversa[], mensagem: string): Content[] {
  const contents: Content[] = historico.map((turno) => ({
    role: turno.autor === "produtor" ? "user" : "model",
    parts: [{ text: turno.texto }],
  }));
  contents.push({ role: "user", parts: [{ text: mensagem }] });
  return contents;
}

export class GeminiProvider implements AIProvider {
  readonly nome = "gemini";
  private client: GoogleGenAI;
  private modelo: string;

  constructor(apiKey: string, modelo: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelo = modelo;
  }

  async gerar({ systemPrompt, historico, mensagem, ferramentas, rodadasAnteriores }: ParametrosGerar): Promise<RespostaGeracao> {
    const contents = paraContents(historico, mensagem);

    for (const rodada of rodadasAnteriores) {
      contents.push({ role: "model", parts: rodada.brutoResposta as Part[] });
      contents.push({
        role: "user",
        parts: rodada.chamadas.map(
          (chamada, i): Part => ({
            functionResponse: {
              id: chamada.idBruto,
              name: chamada.nome,
              response: { resultado: rodada.resultados[i] },
            },
          }),
        ),
      });
    }

    const resposta = await this.client.models.generateContent({
      model: this.modelo,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: ferramentas.map(paraFerramentaGemini) }],
      },
    });

    const uso = resposta.usageMetadata;
    if (uso) {
      const tokensInput = uso.promptTokenCount ?? 0;
      const tokensOutput = (uso.candidatesTokenCount ?? 0) + (uso.thoughtsTokenCount ?? 0);
      registrarUsoIA({
        provider: this.nome,
        modelo: this.modelo,
        tokensInput,
        tokensOutput,
        custoEstimado: estimarCusto("gemini", tokensInput, tokensOutput),
      });
    }

    // Usamos as `parts` brutas da resposta (não o atalho `resposta.functionCalls`)
    // porque cada parte carrega, além da functionCall, o `thoughtSignature`
    // que o Gemini exige de volta intacto ao continuar a conversa.
    const partesResposta = resposta.candidates?.[0]?.content?.parts ?? [];
    const partesComChamada = partesResposta.filter(
      (p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => !!p.functionCall?.name,
    );
    const chamadas: ChamadaFerramenta[] = partesComChamada.map((parte) => ({
      nome: parte.functionCall.name as string,
      input: parte.functionCall.args ?? {},
      idBruto: parte.functionCall.id,
    }));

    if (chamadas.length > 0) {
      return { tipo: "chamadas", chamadas, brutoResposta: partesResposta };
    }
    return { tipo: "texto", texto: resposta.text ?? "" };
  }
}
