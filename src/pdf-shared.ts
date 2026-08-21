import PDFDocument from "pdfkit";

export const COR_PRIMARIA = "#3b2415"; // marrom café escuro
export const COR_SECUNDARIA = "#8a6d3b"; // marrom claro
export const COR_TEXTO = "#1a1a1a";
export const COR_LINHA_ALTERNADA = "#f5f1eb";
export const COR_BORDA_CARD = "#d9cdb8";
export const COR_RODAPE = "#888888";

export function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function larguraPaginaUtil(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

export function desenharCabecalho(doc: PDFKit.PDFDocument, titulo: string, subtitulo: string): void {
  doc.rect(0, 0, doc.page.width, 100).fill(COR_PRIMARIA);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(titulo, 50, 32);
  doc.font("Helvetica").fontSize(13).text(subtitulo, 50, 62);
}

export function desenharCard(
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

export function desenharRodape(doc: PDFKit.PDFDocument, larguraPagina: number, numeroPagina: number, totalPaginas: number): void {
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

export function garantirEspaco(doc: PDFKit.PDFDocument, y: number, alturaNecessaria: number): number {
  if (y + alturaNecessaria > doc.page.height - doc.page.margins.bottom - 30) {
    doc.addPage();
    return 50;
  }
  return y;
}

// Cria o PDFDocument, roda `desenharConteudo` (específico de cada projeto) e
// aplica o rodapé com numeração em todas as páginas geradas.
export function gerarPdfComRodape(
  desenharConteudo: (doc: PDFKit.PDFDocument, larguraPagina: number) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    desenharConteudo(doc, larguraPaginaUtil(doc));

    const larguraPagina = larguraPaginaUtil(doc);
    const paginas = doc.bufferedPageRange();
    for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
      doc.switchToPage(i);
      desenharRodape(doc, larguraPagina, i + 1, paginas.count);
    }

    doc.end();
  });
}
