import { buscarEntriesPorPeriodo, AREAS, type Entry, type Area } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda, formatarQuantidade } from "../../format";
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
import { montarResumoPorArea, montarResumoGeral, NOMES_CATEGORIA, type ResumoArea } from "./reports";
import type { RelatorioPdf } from "../types";

// Nomes de área sem emoji: a fonte padrão do pdfkit (Helvetica/WinAnsi) não
// tem glifos pra emoji e renderiza lixo no PDF — só o relatório em texto
// (WhatsApp) usa a versão com emoji de NOMES_AREA.
const NOMES_AREA_PDF: Record<Area, string> = {
  cafe: "Café",
  propriedade: "Propriedade",
  outro: "Outro",
};

function desenharSecaoArea(doc: PDFKit.PDFDocument, larguraPagina: number, area: Area, resumo: ResumoArea, y: number): number {
  y = garantirEspaco(doc, y, 60);

  doc.fillColor(COR_TEXTO).font("Helvetica-Bold").fontSize(14).text(NOMES_AREA_PDF[area], 50, y);
  y += 20;

  const colhidoTexto =
    resumo.colhidoPorUnidade.size > 0
      ? [...resumo.colhidoPorUnidade.entries()].map(([u, q]) => `${formatarQuantidade(q)} ${u}`).join(", ")
      : null;

  doc.font("Helvetica").fontSize(10).fillColor(COR_TEXTO);
  let linhaResumo = `Despesas: ${formatarMoeda(resumo.despesaTotal)}`;
  if (resumo.receitaTotal > 0) linhaResumo += `   |   Receita: ${formatarMoeda(resumo.receitaTotal)}`;
  if (colhidoTexto) linhaResumo += `   |   Colhido: ${colhidoTexto}`;
  doc.text(linhaResumo, 50, y, { width: larguraPagina });
  y += 22;

  const colunas = [
    { titulo: "Categoria", largura: 140 },
    { titulo: "Registros", largura: 65 },
    { titulo: "Quantidade", largura: larguraPagina - 140 - 65 - 110 },
    { titulo: "Custo/Receita", largura: 110 },
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
  for (const [categoria, resumoCat] of resumo.porCategoria) {
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

    const quantidadeTexto =
      resumoCat.quantidadesPorUnidade.size > 0
        ? [...resumoCat.quantidadesPorUnidade.entries()].map(([u, q]) => `${formatarQuantidade(q)} ${u}`).join(", ")
        : "-";
    const valorTexto = resumoCat.valorTotal > 0 ? formatarMoeda(resumoCat.valorTotal) : "-";

    let x = 50;
    doc.fillColor(COR_TEXTO).font("Helvetica").fontSize(9);
    doc.text(NOMES_CATEGORIA[categoria] ?? categoria, x + 6, y + 6, { width: colunas[0].largura - 12 });
    x += colunas[0].largura;
    doc.text(String(resumoCat.quantidadeRegistros), x + 6, y + 6, { width: colunas[1].largura - 12 });
    x += colunas[1].largura;
    doc.text(quantidadeTexto, x + 6, y + 6, { width: colunas[2].largura - 12 });
    x += colunas[2].largura;
    doc.text(valorTexto, x + 6, y + 6, { width: colunas[3].largura - 12 });

    y += alturaLinha;
  }

  return y + 20;
}

function desenharRelatorio(doc: PDFKit.PDFDocument, larguraPagina: number, ano: number, mes: number, entries: Entry[], area?: Area): void {
  const nomeMes = NOMES_MES[mes - 1];
  const titulo = area ? `Relatório — ${NOMES_AREA_PDF[area]}` : "Relatório de Gastos e Produção";
  desenharCabecalho(doc, titulo, `${capitalizar(nomeMes)} de ${ano}`);

  if (entries.length === 0) {
    doc
      .fillColor(COR_TEXTO)
      .font("Helvetica")
      .fontSize(12)
      .text(`Nenhum registro encontrado em ${nomeMes}/${ano}.`, 50, 140);
    return;
  }

  const porArea = montarResumoPorArea(entries);
  const geral = montarResumoGeral(porArea);

  let y = 130;
  const espacamento = 15;
  const larguraCard = (larguraPagina - espacamento * 3) / 4;
  desenharCard(doc, 50, y, larguraCard, "Despesa total", formatarMoeda(geral.despesaTotal));
  desenharCard(doc, 50 + (larguraCard + espacamento), y, larguraCard, "Receita total", formatarMoeda(geral.receitaTotal));
  desenharCard(doc, 50 + (larguraCard + espacamento) * 2, y, larguraCard, "Saldo", formatarMoeda(geral.receitaTotal - geral.despesaTotal));
  const colhidoTexto =
    geral.colhidoPorUnidade.size > 0
      ? [...geral.colhidoPorUnidade.entries()].map(([u, q]) => `${formatarQuantidade(q)} ${u}`).join(", ")
      : "Nenhum registro";
  desenharCard(doc, 50 + (larguraCard + espacamento) * 3, y, larguraCard, "Total colhido", colhidoTexto);

  y += 110;

  for (const areaAtual of AREAS) {
    const resumoArea = porArea.get(areaAtual);
    if (!resumoArea) continue;
    y = desenharSecaoArea(doc, larguraPagina, areaAtual, resumoArea, y);
  }
}

export async function gerarRelatorioPdf(offsetMeses: number, extra?: Record<string, unknown>): Promise<RelatorioPdf> {
  const area = extra?.area as Area | undefined;
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const todasEntries = await buscarEntriesPorPeriodo(inicio, fim);
  const entries = area ? todasEntries.filter((e) => e.area === area) : todasEntries;

  const buffer = await gerarPdfComRodape((doc, larguraPagina) => desenharRelatorio(doc, larguraPagina, ano, mes, entries, area));

  const sufixoArea = area ? `-${area}` : "";
  return { buffer, nomeArquivo: `relatorio-rural-${ano}-${String(mes).padStart(2, "0")}${sufixoArea}.pdf` };
}
