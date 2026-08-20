import PDFDocument from "pdfkit";
import { buscarEntriesPorPeriodo, type Entry, type Categoria } from "./db";
import { NOMES_MES, montarResumo, formatarMoeda, formatarQuantidade, obterIntervaloMes } from "./reports";

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
};

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function gerarPdfRelatorio(ano: number, mes: number, entries: Entry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    desenharRelatorio(doc, ano, mes, entries);
    doc.end();
  });
}

function desenharCabecalho(doc: PDFKit.PDFDocument, nomeMes: string, ano: number): void {
  doc.rect(0, 0, doc.page.width, 100).fill(COR_PRIMARIA);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("Relatório de Gastos e Produção", 50, 32);
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
    .fontSize(10)
    .text(titulo.toUpperCase(), x + 15, y + 15);
  doc
    .fillColor(COR_PRIMARIA)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(valor, x + 15, y + 36, { width: largura - 30 });
}

function desenharRodape(doc: PDFKit.PDFDocument, larguraPagina: number): void {
  const dataGeracao = new Date().toLocaleString("pt-BR");
  // Posiciona dentro da área de margem segura (abaixo disso o pdfkit acha
  // que o texto não cabe e insere uma página nova automaticamente).
  const y = doc.page.height - doc.page.margins.bottom - 20;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COR_RODAPE)
    .text(`Gerado automaticamente em ${dataGeracao}`, 50, y, {
      width: larguraPagina,
      align: "center",
      lineBreak: false,
    });
}

function desenharRelatorio(doc: PDFKit.PDFDocument, ano: number, mes: number, entries: Entry[]): void {
  const nomeMes = NOMES_MES[mes - 1];
  const larguraPagina = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  desenharCabecalho(doc, nomeMes, ano);

  if (entries.length === 0) {
    doc
      .fillColor(COR_TEXTO)
      .font("Helvetica")
      .fontSize(12)
      .text(`Nenhum registro encontrado em ${nomeMes}/${ano}.`, 50, 140);
    desenharRodape(doc, larguraPagina);
    return;
  }

  const { totalGasto, colhidoPorUnidade, porCategoria } = montarResumo(entries);

  let y = 130;
  const larguraCard = (larguraPagina - 20) / 2;
  desenharCard(doc, 50, y, larguraCard, "Total gasto", formatarMoeda(totalGasto));
  const colhidoTexto =
    colhidoPorUnidade.size > 0
      ? [...colhidoPorUnidade.entries()].map(([u, q]) => `${formatarQuantidade(q)} ${u}`).join(", ")
      : "Nenhum registro";
  desenharCard(doc, 50 + larguraCard + 20, y, larguraCard, "Total colhido", colhidoTexto);

  y += 110;

  doc.fillColor(COR_TEXTO).font("Helvetica-Bold").fontSize(14).text("Detalhamento por categoria", 50, y);
  y += 26;

  const colunas = [
    { titulo: "Categoria", largura: 150 },
    { titulo: "Registros", largura: 80 },
    { titulo: "Custo", largura: 110 },
    { titulo: "Quantidade", largura: larguraPagina - 150 - 80 - 110 },
  ];

  function desenharCabecalhoTabela(): void {
    doc.rect(50, y, larguraPagina, 24).fill(COR_SECUNDARIA);
    let x = 50;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
    for (const col of colunas) {
      doc.text(col.titulo, x + 6, y + 7, { width: col.largura - 12 });
      x += col.largura;
    }
    y += 24;
  }

  desenharCabecalhoTabela();

  let linhaAlternada = false;
  for (const [categoria, resumo] of porCategoria) {
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
      resumo.quantidadesPorUnidade.size > 0
        ? [...resumo.quantidadesPorUnidade.entries()].map(([u, q]) => `${formatarQuantidade(q)} ${u}`).join(", ")
        : "-";

    let x = 50;
    doc.fillColor(COR_TEXTO).font("Helvetica").fontSize(10);
    doc.text(NOMES_CATEGORIA[categoria] ?? categoria, x + 6, y + 6, { width: colunas[0].largura - 12 });
    x += colunas[0].largura;
    doc.text(String(resumo.quantidadeRegistros), x + 6, y + 6, { width: colunas[1].largura - 12 });
    x += colunas[1].largura;
    doc.text(resumo.custoTotal > 0 ? formatarMoeda(resumo.custoTotal) : "-", x + 6, y + 6, {
      width: colunas[2].largura - 12,
    });
    x += colunas[2].largura;
    doc.text(quantidadeTexto, x + 6, y + 6, { width: colunas[3].largura - 12 });

    y += alturaLinha;
  }

  desenharRodape(doc, larguraPagina);
}

export interface RelatorioPdf {
  buffer: Buffer;
  nomeArquivo: string;
}

async function gerarRelatorioPdfComOffset(offsetMeses: number): Promise<RelatorioPdf> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const entries = buscarEntriesPorPeriodo(inicio, fim);
  const buffer = await gerarPdfRelatorio(ano, mes, entries);
  return { buffer, nomeArquivo: `relatorio-rural-${ano}-${String(mes).padStart(2, "0")}.pdf` };
}

export function gerarPdfRelatorioMesAtual(): Promise<RelatorioPdf> {
  return gerarRelatorioPdfComOffset(0);
}

export function gerarPdfRelatorioMesPassado(): Promise<RelatorioPdf> {
  return gerarRelatorioPdfComOffset(-1);
}
