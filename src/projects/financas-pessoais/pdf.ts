import { buscarLancamentosPorPeriodo, type Lancamento } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda } from "../../format";
import {
  COR_PRIMARIA,
  COR_SECUNDARIA,
  COR_TEXTO,
  COR_LINHA_ALTERNADA,
  capitalizar,
  desenharCabecalho,
  desenharCard,
  garantirEspaco,
  gerarPdfComRodape,
} from "../../pdf-shared";
import { montarResumo } from "./reports";
import type { RelatorioPdf } from "../types";

function desenharTabela(
  doc: PDFKit.PDFDocument,
  larguraPagina: number,
  titulo: string,
  linhas: { rotulo: string; valor: string; extra: string }[],
  y: number,
): number {
  y = garantirEspaco(doc, y, 60);
  doc.fillColor(COR_TEXTO).font("Helvetica-Bold").fontSize(14).text(titulo, 50, y);
  y += 24;

  if (linhas.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(COR_TEXTO).text("Nenhum registro.", 50, y);
    return y + 24;
  }

  const colunas = [
    { titulo: "Categoria", largura: larguraPagina - 110 - 100 },
    { titulo: "Registros", largura: 100 },
    { titulo: "Valor", largura: 110 },
  ];

  function desenharCabecalhoTabela(): void {
    doc.rect(50, y, larguraPagina, 22).fill(COR_SECUNDARIA);
    let x = 50;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    for (const col of colunas) {
      doc.text(col.titulo, x + 6, y + 6, { width: col.largura - 12 });
      x += col.largura;
    }
    y += 22;
  }

  y = garantirEspaco(doc, y, 22);
  desenharCabecalhoTabela();

  let linhaAlternada = false;
  for (const linha of linhas) {
    const alturaLinha = 22;
    if (y + alturaLinha > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = 50;
      desenharCabecalhoTabela();
    }
    if (linhaAlternada) {
      doc.rect(50, y, larguraPagina, alturaLinha).fill(COR_LINHA_ALTERNADA);
    }
    linhaAlternada = !linhaAlternada;

    let x = 50;
    doc.fillColor(COR_TEXTO).font("Helvetica").fontSize(9);
    doc.text(linha.rotulo, x + 6, y + 6, { width: colunas[0].largura - 12 });
    x += colunas[0].largura;
    doc.text(linha.extra, x + 6, y + 6, { width: colunas[1].largura - 12 });
    x += colunas[1].largura;
    doc.text(linha.valor, x + 6, y + 6, { width: colunas[2].largura - 12 });

    y += alturaLinha;
  }

  return y + 20;
}

function desenharRelatorio(doc: PDFKit.PDFDocument, larguraPagina: number, ano: number, mes: number, lancamentos: Lancamento[]): void {
  const nomeMes = NOMES_MES[mes - 1];
  desenharCabecalho(doc, "Relatório — Finanças Pessoais", `${capitalizar(nomeMes)} de ${ano}`);

  if (lancamentos.length === 0) {
    doc
      .fillColor(COR_TEXTO)
      .font("Helvetica")
      .fontSize(12)
      .text(`Nenhum lançamento encontrado em ${nomeMes}/${ano}.`, 50, 140);
    return;
  }

  const resumo = montarResumo(lancamentos);

  let y = 130;
  const espacamento = 15;
  const larguraCard = (larguraPagina - espacamento * 2) / 3;
  desenharCard(doc, 50, y, larguraCard, "Despesas", formatarMoeda(resumo.despesaTotal));
  desenharCard(doc, 50 + (larguraCard + espacamento), y, larguraCard, "Receitas", formatarMoeda(resumo.receitaTotal));
  desenharCard(doc, 50 + (larguraCard + espacamento) * 2, y, larguraCard, "Saldo", formatarMoeda(resumo.receitaTotal - resumo.despesaTotal));

  y += 110;

  const linhasDespesa = [...resumo.porCategoriaDespesa.entries()]
    .sort((a, b) => b[1].valorTotal - a[1].valorTotal)
    .map(([categoria, r]) => ({ rotulo: categoria, extra: String(r.quantidadeRegistros), valor: formatarMoeda(r.valorTotal) }));
  y = desenharTabela(doc, larguraPagina, "Despesas por categoria", linhasDespesa, y);

  const linhasReceita = [...resumo.porCategoriaReceita.entries()]
    .sort((a, b) => b[1].valorTotal - a[1].valorTotal)
    .map(([categoria, r]) => ({ rotulo: categoria, extra: String(r.quantidadeRegistros), valor: formatarMoeda(r.valorTotal) }));
  y = desenharTabela(doc, larguraPagina, "Receitas por categoria", linhasReceita, y);

  if (resumo.porFormaPagamento.size > 0) {
    const linhasForma = [...resumo.porFormaPagamento.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([forma, total]) => ({ rotulo: forma, extra: "", valor: formatarMoeda(total) }));
    desenharTabela(doc, larguraPagina, "Despesas por forma de pagamento", linhasForma, y);
  }
}

export async function gerarRelatorioPdf(offsetMeses: number): Promise<RelatorioPdf> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const lancamentos = await buscarLancamentosPorPeriodo(inicio, fim);

  const buffer = await gerarPdfComRodape((doc, larguraPagina) => desenharRelatorio(doc, larguraPagina, ano, mes, lancamentos));

  return { buffer, nomeArquivo: `relatorio-financas-${ano}-${String(mes).padStart(2, "0")}.pdf` };
}
