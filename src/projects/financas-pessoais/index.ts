import { formatarDataBR, formatarMoeda } from "../../format";
import type { ProjetoDef, RegistroSalvo } from "../types";
import { inserirLancamento, listarRecentes, excluirPorId, type LancamentoParaSalvar, type Lancamento } from "./db";
import { FERRAMENTAS, executarFerramenta } from "./tools";
import { gerarSystemPrompt, parseRegistro, parseArgumentosPdf } from "./prompt";
import { gerarRelatorioTexto } from "./reports";
import { gerarRelatorioPdf } from "./pdf";

function formatarResumoConfirmacao(dados: Record<string, unknown>): string {
  const lancamento = dados as unknown as LancamentoParaSalvar;
  const linhas = [
    "Entendi o seguinte:",
    "",
    `Data: ${formatarDataBR(lancamento.data)}`,
    `Tipo: ${lancamento.tipo}`,
    `Categoria: ${lancamento.categoria}`,
    `Valor: ${formatarMoeda(lancamento.valor)}`,
  ];

  if (lancamento.descricao) linhas.push(`Descrição: ${lancamento.descricao}`);
  if (lancamento.forma_pagamento) linhas.push(`Forma de pagamento: ${lancamento.forma_pagamento}`);

  linhas.push("", 'Confirma? Responda "sim", "corrigir" ou "não".');
  return linhas.join("\n");
}

function formatarLinhaRegistro(item: RegistroSalvo): string {
  const lancamento = item as unknown as Lancamento;
  const partes = [formatarDataBR(lancamento.data), lancamento.tipo, lancamento.categoria];
  if (lancamento.descricao) partes.push(lancamento.descricao);
  partes.push(formatarMoeda(lancamento.valor));
  return partes.join(" - ");
}

export const financasPessoais: ProjetoDef = {
  nome: "financas_pessoais",
  nomeExibicao: "Finanças Pessoais",
  systemPrompt: gerarSystemPrompt,
  ferramentas: FERRAMENTAS,
  executarFerramenta,
  nomeFerramentaRegistrar: "registrar_lancamento",
  nomeFerramentaPdf: "gerar_relatorio_pdf",
  parseRegistro,
  inserir: (dados) => inserirLancamento(dados as unknown as LancamentoParaSalvar),
  formatarResumoConfirmacao,
  listarRecentes: (limite) => listarRecentes(limite) as unknown as Promise<RegistroSalvo[]>,
  excluirPorId,
  formatarLinhaRegistro,
  gerarRelatorioTexto,
  gerarRelatorioPdf,
  parseArgumentosPdf,
};
