import type { FerramentaDef } from "../ai/types";

export type Projeto = "gestao_rural" | "financas_pessoais";

export const PROJETOS_VALIDOS: Projeto[] = ["gestao_rural", "financas_pessoais"];

export function ehProjetoValido(valor: string): valor is Projeto {
  return (PROJETOS_VALIDOS as string[]).includes(valor);
}

export interface ResultadoFerramenta {
  ferramenta: string;
  resultado?: unknown;
  erro?: string;
}

// Registro genérico já salvo (id + auditoria) — os campos específicos de cada
// projeto (área/categoria vs. tipo/categoria/forma de pagamento etc.) ficam
// acessíveis por índice, mas cada projeto sabe o shape real por trás disso.
export interface RegistroSalvo {
  id: number;
  criado_em: string;
  mensagem_original: string;
  [campo: string]: unknown;
}

export interface RelatorioPdf {
  buffer: Buffer;
  nomeArquivo: string;
}

// Cada projeto (gestão rural, finanças pessoais) monta um destes — o app
// (src/index.ts) e o parser.ts (src/parser.ts) operam só sobre essa
// interface, sem saber qual projeto é. Toda diferença de comportamento fica
// dentro do módulo do projeto.
export interface ProjetoDef {
  nome: Projeto;
  nomeExibicao: string;
  systemPrompt: string;
  ferramentas: FerramentaDef[];
  executarFerramenta: (nome: string, input: unknown) => Promise<ResultadoFerramenta>;
  nomeFerramentaRegistrar: string;
  nomeFerramentaPdf: string;
  // Valida o input bruto da ferramenta de registro (já escolhido pela IA) e
  // devolve os dados prontos pra salvar — mesmo papel que `EntradaSchema.parse`
  // tinha direto em `parser.ts` antes desta fase.
  parseRegistro: (input: unknown) => Record<string, unknown>;
  inserir: (dados: Record<string, unknown>) => Promise<number>;
  formatarResumoConfirmacao: (dados: Record<string, unknown>) => string;
  listarRecentes: (limite: number) => Promise<RegistroSalvo[]>;
  excluirPorId: (id: number) => Promise<boolean>;
  formatarLinhaRegistro: (item: RegistroSalvo) => string;
  gerarRelatorioTexto: (offsetMeses: number) => Promise<string>;
  // `extra` carrega filtros específicos do projeto (ex: área, na gestão
  // rural) — vem do input bruto da ferramenta `gerar_relatorio_pdf`,
  // validado por `parseArgumentosPdf`.
  gerarRelatorioPdf: (offsetMeses: number, extra?: Record<string, unknown>) => Promise<RelatorioPdf>;
  // Valida o input bruto da ferramenta de PDF (já escolhida pela IA) e
  // resolve o período ("mes_atual"/"mes_passado") pro offset numérico que
  // `gerarRelatorioPdf` espera.
  parseArgumentosPdf: (input: unknown) => { offsetMeses: number; extra?: Record<string, unknown> };
}
