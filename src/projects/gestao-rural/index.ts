import { formatarDataBR, formatarMoeda } from "../../format";
import type { ProjetoDef, RegistroSalvo } from "../types";
import {
  inserirEntry,
  listarRegistrosRecentes,
  excluirRegistroPorId,
  type EntradaParaSalvar,
  type Entry,
} from "./db";
import { FERRAMENTAS, executarFerramenta } from "./tools";
import { gerarSystemPrompt, parseRegistro, parseArgumentosPdf } from "./prompt";
import { gerarRelatorioTexto } from "./reports";
import { gerarRelatorioPdf } from "./pdf";

function formatarResumoConfirmacao(dados: Record<string, unknown>): string {
  const entrada = dados as unknown as EntradaParaSalvar;
  const linhas = [
    "Entendi o seguinte:",
    "",
    `Data: ${formatarDataBR(entrada.data)}`,
    `Área: ${entrada.area}`,
    `Categoria: ${entrada.categoria}`,
  ];

  if (entrada.item) linhas.push(`Item: ${entrada.item}`);
  if (entrada.quantidade !== null) {
    linhas.push(`Quantidade: ${entrada.quantidade}${entrada.unidade ? " " + entrada.unidade : ""}`);
  }
  if (entrada.custo !== null) {
    const rotulo = entrada.categoria === "venda" ? "Receita" : "Custo";
    linhas.push(`${rotulo}: ${formatarMoeda(entrada.custo)}`);
  }
  if (entrada.local) linhas.push(`Local: ${entrada.local}`);
  if (entrada.observacao) linhas.push(`Observação: ${entrada.observacao}`);

  linhas.push("", 'Confirma? Responda "sim", "corrigir" ou "não".');
  return linhas.join("\n");
}

function formatarLinhaRegistro(item: RegistroSalvo): string {
  const entry = item as unknown as Entry;
  const partes = [formatarDataBR(entry.data), entry.area, entry.categoria];
  if (entry.item) partes.push(entry.item);
  if (entry.quantidade !== null) {
    partes.push(`${entry.quantidade}${entry.unidade ? " " + entry.unidade : ""}`);
  }
  if (entry.custo !== null) partes.push(formatarMoeda(entry.custo));
  return partes.join(" - ");
}

export const gestaoRural: ProjetoDef = {
  nome: "gestao_rural",
  nomeExibicao: "Gestão Rural",
  systemPrompt: gerarSystemPrompt,
  ferramentas: FERRAMENTAS,
  executarFerramenta,
  nomeFerramentaRegistrar: "registrar_entrada",
  nomeFerramentaPdf: "gerar_relatorio_pdf",
  parseRegistro,
  inserir: (dados) => inserirEntry(dados as unknown as EntradaParaSalvar),
  formatarResumoConfirmacao,
  listarRecentes: (limite) => listarRegistrosRecentes(limite) as unknown as Promise<RegistroSalvo[]>,
  excluirPorId: excluirRegistroPorId,
  formatarLinhaRegistro,
  gerarRelatorioTexto,
  gerarRelatorioPdf,
  parseArgumentosPdf,
};
