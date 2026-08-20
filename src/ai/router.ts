import type {
  AIProvider,
  ChamadaFerramenta,
  FerramentaDef,
  RodadaFerramentas,
  TurnoConversa,
} from "./types";

export type Complexidade = "simples" | "complexa";

// Heurística local — de propósito NÃO é uma chamada de IA: classificar com um
// modelo antes de cada mensagem anularia o ganho de custo de rotear para o
// provider mais barato na maioria das vezes.
const PALAVRAS_COMPLEXAS = [
  "analise",
  "análise",
  "analisar",
  "compare",
  "comparar",
  "comparação",
  "parecer",
  "relatório executivo",
  "relatorio executivo",
  "aprofund",
  "tendência",
  "tendencia",
  "explique",
  "avalie",
  "avaliação",
];

export function classificarComplexidade(texto: string): Complexidade {
  const normalizado = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  const temPalavraComplexa = PALAVRAS_COMPLEXAS.some((palavra) =>
    normalizado.includes(
      palavra.normalize("NFD").replace(/[̀-ͯ]/g, ""),
    ),
  );

  if (temPalavraComplexa) return "complexa";
  if (texto.length > 220) return "complexa";
  return "simples";
}

export interface ParametrosInterpretacao {
  systemPrompt: string;
  historico: TurnoConversa[];
  mensagem: string;
  ferramentas: FerramentaDef[];
}

export type ResultadoRouter =
  | { tipo: "registrar"; chamada: ChamadaFerramenta; provider: string }
  | { tipo: "texto"; texto: string; provider: string; teveFerramentas: boolean };

const MAX_RODADAS = 4;

export class AIRouter {
  constructor(
    private providerSimples: AIProvider,
    private providerComplexo: AIProvider,
  ) {}

  async interpretar(
    params: ParametrosInterpretacao,
    executarFerramenta: (nome: string, input: unknown) => unknown,
  ): Promise<ResultadoRouter> {
    const complexidade = classificarComplexidade(params.mensagem);
    const principal = complexidade === "complexa" ? this.providerComplexo : this.providerSimples;
    const alternativo = principal === this.providerComplexo ? this.providerSimples : this.providerComplexo;

    try {
      return await this.executarLoop(principal, params, executarFerramenta);
    } catch (err) {
      console.error(`Erro no provider "${principal.nome}", tentando "${alternativo.nome}":`, err);
      return await this.executarLoop(alternativo, params, executarFerramenta);
    }
  }

  private async executarLoop(
    provider: AIProvider,
    params: ParametrosInterpretacao,
    executarFerramenta: (nome: string, input: unknown) => unknown,
  ): Promise<ResultadoRouter> {
    const rodadasAnteriores: RodadaFerramentas[] = [];

    for (let i = 0; i < MAX_RODADAS; i++) {
      const resposta = await provider.gerar({ ...params, rodadasAnteriores });

      if (resposta.tipo === "texto") {
        return { tipo: "texto", texto: resposta.texto, provider: provider.nome, teveFerramentas: rodadasAnteriores.length > 0 };
      }

      const chamadaRegistrar = resposta.chamadas.find((c) => c.nome === "registrar_entrada");
      if (chamadaRegistrar) {
        return { tipo: "registrar", chamada: chamadaRegistrar, provider: provider.nome };
      }

      const resultados = resposta.chamadas.map((c) => executarFerramenta(c.nome, c.input));
      rodadasAnteriores.push({ chamadas: resposta.chamadas, resultados, brutoResposta: resposta.brutoResposta });
    }

    return {
      tipo: "texto",
      texto: "Essa consulta ficou grande demais pra eu concluir de uma vez. Tenta perguntar em partes?",
      provider: provider.nome,
      teveFerramentas: true,
    };
  }
}
