import PDFDocument from "pdfkit";
import { buscarEntriesPorPeriodo, AREAS, type Entry, type Categoria, type Area } from "./db";
import {
  NOMES_MES,
  montarResumoPorArea,
  montarResumoGeral,
  formatarMoeda,
  formatarQuantidade,
  obterIntervaloMes,
  type ResumoArea,
} from "./reports";

// Nomes de área sem emoji: a fonte padrão do pdfkit (Helvetica/WinAnsi) não
// tem glifos pra emoji e renderiza lixo no PDF — só o relatório em texto
// (WhatsApp) usa a versão com emoji de NOMES_AREA.
const NOMES_AREA_PDF: Record<Area, string> = {
  cafe: "Café",
  propriedade: "Propriedade",
  outro: "Outro",
};

const COR_PRIMARIA = "#3b2415"; // marrom café escuro
const COR_SECUNDARIA = "#8a6d3b"; // marrom claro
const COR_TEXTO = "#1a1a1a";
const COR_LINHA_ALTERNADA = "#f5f1eb";
const COR_BORDA_CARD = "#d9cdb8";
const COR_RODAPE = "#888888";

const NOMES_CATEGORIA: Record<Categoria, string> = {
  adubacao: "Adubação",
  colheita: "Colheita",
  poda: "Poda",
  defensivo: "Defensivo",
  mao_de_obra: "Mão de obra",
  venda: "Venda",
  outro: "Outro",
  manutencao: "Manutenção",
  combustivel: "Combustível",
  energia: "Energia",
  agua: "Água",
  insumo: "Insumo",
};

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function gerarPdfRelatorio(ano: number, mes: number, entries: Entry[], area?: Area): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    desenharRelatorio(doc, ano, mes, entries, area);

    const larguraPagina = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const paginas = doc.bufferedPageRange();
    for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
      doc.switchToPage(i);
      desenharRodape(doc, larguraPagina, i + 1, paginas.count);
    }

    doc.end();
  });
}

function desenharCabecalho(doc: PDFKit.PDFDocument, nomeMes: string, ano: number, area?: Area): void {
  doc.rect(0, 0, doc.page.width, 100).fill(COR_PRIMARIA);
  const titulo = area ? `Relatório — ${NOMES_AREA_PDF[area]}` : "Relatório de Gastos e Produção";
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text(titulo, 50, 32);
  doc
    .font("Helvetica")
    .fontSize(13)
    .text(`${capitalizar(nomeMes)} de ${ano}`, 50, 62);
}

function desenharCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  largura: number,
  titulo: string,
  valor: string,
): void {
  doc.rect(x, y, largura, 80).fillAndStroke(COR_LINHA_ALTERNADA, COR_BORDA_CARD);
  doc
    .fillColor("#6b5a45")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(titulo.toUpperCase(), x + 12, y + 14, { width: largura - 24 });
  doc
    .fillColor(COR_PRIMARIA)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(valor, x + 12, y + 38, { width: largura - 24 });
}

function desenharRodape(doc: PDFKit.PDFDocument, larguraPagina: number, numeroPagina: number, totalPaginas: number): void {
  const dataGeracao = new Date().toLocaleString("pt-BR");
  // Posiciona dentro da área de margem segura (abaixo disso o pdfkit acha
  // que o texto não cabe e insere uma página nova automaticamente).
  const y = doc.page.height - doc.page.margins.bottom - 20;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COR_RODAPE)
    .text(`Gerado automaticamente em ${dataGeracao} — Página ${numeroPagina} de ${totalPaginas}`, 50, y, {
      width: larguraPagina,
      align: "center",
      lineBreak: false,
    });
}

function garantirEspaco(doc: PDFKit.PDFDocument, y: number, alturaNecessaria: number): number {
  if (y + alturaNecessaria > doc.page.height - doc.page.margins.bottom - 30) {
    doc.addPage();
    return 50;
  }
  return y;
}

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

function desenharRelatorio(doc: PDFKit.PDFDocument, ano: number, mes: number, entries: Entry[], area?: Area): void {
  const nomeMes = NOMES_MES[mes - 1];
  const larguraPagina = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  desenharCabecalho(doc, nomeMes, ano, area);

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

export interface RelatorioPdf {
  buffer: Buffer;
  nomeArquivo: string;
}

async function gerarRelatorioPdfComOffset(offsetMeses: number, area?: Area): Promise<RelatorioPdf> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const todasEntries = buscarEntriesPorPeriodo(inicio, fim);
  const entries = area ? todasEntries.filter((e) => e.area === area) : todasEntries;
  const buffer = await gerarPdfRelatorio(ano, mes, entries, area);
  const sufixoArea = area ? `-${area}` : "";
  return { buffer, nomeArquivo: `relatorio-rural-${ano}-${String(mes).padStart(2, "0")}${sufixoArea}.pdf` };
}

export function gerarPdfRelatorioMesAtual(area?: Area): Promise<RelatorioPdf> {
  return gerarRelatorioPdfComOffset(0, area);
}

export function gerarPdfRelatorioMesPassado(area?: Area): Promise<RelatorioPdf> {
  return gerarRelatorioPdfComOffset(-1, area);
}
