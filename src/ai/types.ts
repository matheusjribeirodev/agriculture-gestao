export interface FerramentaDef {
  nome: string;
  descricao: string;
  // JSON Schema puro (mesmo formato aceito tanto pela Claude quanto pelo Gemini
  // para declarar os parâmetros de uma ferramenta).
  schema: Record<string, unknown>;
}

export interface TurnoConversa {
  autor: "produtor" | "bot";
  texto: string;
}

export interface ChamadaFerramenta {
  nome: string;
  input: unknown;
  // Identificador da chamada dentro da resposta bruta do provider (ex:
  // `tool_use.id` na Claude, `functionCall.id` no Gemini) — usado para casar
  // o resultado de volta à chamada correta na próxima rodada.
  idBruto?: string;
}

// Uma rodada completa: o provider pediu essas ferramentas, a aplicação
// executou e devolveu esses resultados (mesma ordem de `chamadas`).
// `brutoResposta` é o conteúdo original da resposta do provider naquela
// rodada (tipo específico de cada SDK) — necessário para reconstruir o
// histórico de conversa corretamente na próxima chamada (ex: a Claude espera
// os blocos de "thinking" de volta inalterados; o Gemini exige o
// `thoughtSignature` de cada function call). Cada provider só sabe
// interpretar o `brutoResposta` que ele mesmo gerou.
export interface RodadaFerramentas {
  chamadas: ChamadaFerramenta[];
  resultados: unknown[];
  brutoResposta: unknown;
}

export type RespostaGeracao =
  | { tipo: "chamadas"; chamadas: ChamadaFerramenta[]; brutoResposta: unknown }
  | { tipo: "texto"; texto: string };

export interface ParametrosGerar {
  systemPrompt: string;
  historico: TurnoConversa[];
  mensagem: string;
  ferramentas: FerramentaDef[];
  // Rodadas de ferramentas já concluídas nesta mesma interação (loop de
  // tool-use) — vazio na primeira chamada.
  rodadasAnteriores: RodadaFerramentas[];
}

export interface AIProvider {
  readonly nome: string;
  gerar(params: ParametrosGerar): Promise<RespostaGeracao>;
}
