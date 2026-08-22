import { buscarEntriesPorPeriodo, AREAS, type Entry, type Categoria, type Area } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda, formatarQuantidade } from "../../format";

export const NOMES_AREA: Record<Area, string> = {
  cafe: "☕ Café",
  propriedade: "🏡 Propriedade",
  outro: "📦 Outro",
};

// Usado tanto pelo relatório em texto quanto pelo PDF (que importa daqui em
// vez de manter sua própria cópia).
export const NOMES_CATEGORIA: Record<Categoria, string> = {
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

export interface ResumoCategoria {
  quantidadeRegistros: number;
  // Para categoria "venda" isso é receita; para as demais, despesa.
  valorTotal: number;
  quantidadesPorUnidade: Map<string, number>;
  // Registros individuais dessa categoria — usado pra detalhar por item no
  // relatório em texto quando há mais de um registro (ver `gerarTexto`).
  entradas: Entry[];
}

export interface ResumoArea {
  despesaTotal: number;
  receitaTotal: number;
  colhidoPorUnidade: Map<string, number>;
  porCategoria: Map<Categoria, ResumoCategoria>;
}

export function montarResumoPorArea(entries: Entry[]): Map<Area, ResumoArea> {
  const porArea = new Map<Area, ResumoArea>();

  for (const entry of entries) {
    if (!porArea.has(entry.area)) {
      porArea.set(entry.area, {
        despesaTotal: 0,
        receitaTotal: 0,
        colhidoPorUnidade: new Map(),
        porCategoria: new Map(),
      });
    }
    const resumo = porArea.get(entry.area)!;

    if (entry.custo !== null) {
      if (entry.categoria === "venda") {
        resumo.receitaTotal += entry.custo;
      } else {
        resumo.despesaTotal += entry.custo;
      }
    }

    if (entry.categoria === "colheita" && entry.quantidade !== null && entry.unidade) {
      resumo.colhidoPorUnidade.set(
        entry.unidade,
        (resumo.colhidoPorUnidade.get(entry.unidade) ?? 0) + entry.quantidade,
      );
    }

    if (!resumo.porCategoria.has(entry.categoria)) {
      resumo.porCategoria.set(entry.categoria, {
        quantidadeRegistros: 0,
        valorTotal: 0,
        quantidadesPorUnidade: new Map(),
        entradas: [],
      });
    }
    const resumoCat = resumo.porCategoria.get(entry.categoria)!;
    resumoCat.quantidadeRegistros += 1;
    resumoCat.entradas.push(entry);
    if (entry.custo !== null) {
      resumoCat.valorTotal += entry.custo;
    }
    if (entry.quantidade !== null && entry.unidade) {
      resumoCat.quantidadesPorUnidade.set(
        entry.unidade,
        (resumoCat.quantidadesPorUnidade.get(entry.unidade) ?? 0) + entry.quantidade,
      );
    }
  }

  return porArea;
}

export interface ResumoGeral {
  despesaTotal: number;
  receitaTotal: number;
  colhidoPorUnidade: Map<string, number>;
}

export function montarResumoGeral(porArea: Map<Area, ResumoArea>): ResumoGeral {
  let despesaTotal = 0;
  let receitaTotal = 0;
  const colhidoPorUnidade = new Map<string, number>();

  for (const resumo of porArea.values()) {
    despesaTotal += resumo.despesaTotal;
    receitaTotal += resumo.receitaTotal;
    for (const [unidade, quantidade] of resumo.colhidoPorUnidade) {
      colhidoPorUnidade.set(unidade, (colhidoPorUnidade.get(unidade) ?? 0) + quantidade);
    }
  }

  return { despesaTotal, receitaTotal, colhidoPorUnidade };
}

function formatarPartesUnidade(porUnidade: Map<string, number>): string {
  return [...porUnidade.entries()].map(([unidade, total]) => `${formatarQuantidade(total)} ${unidade}`).join(", ");
}

function pluralRegistro(n: number): string {
  return n === 1 ? "1 registro" : `${n} registros`;
}

// Uma categoria com só um registro já é clara na linha de resumo — o
// detalhamento por item só aparece (e só ajuda) quando há mais de um
// registro na mesma categoria, que é quando "2 registros, R$ X" esconde o
// que cada um foi de fato.
function formatarLinhasItens(entradas: Entry[]): string[] {
  return entradas.map((entrada) => {
    const partes = [entrada.item ?? "(sem item)"];
    if (entrada.quantidade !== null) {
      partes.push(`${formatarQuantidade(entrada.quantidade)}${entrada.unidade ? " " + entrada.unidade : ""}`);
    }
    if (entrada.custo !== null) {
      partes.push(formatarMoeda(entrada.custo));
    }
    if (entrada.local) partes.push(entrada.local);
    return `  ↳ ${partes.join(" — ")}`;
  });
}

function gerarTexto(ano: number, mes: number, entries: Entry[]): string {
  const nomeMes = NOMES_MES[mes - 1];

  if (entries.length === 0) {
    return `Nenhum registro encontrado em ${nomeMes}/${ano}.`;
  }

  const porArea = montarResumoPorArea(entries);

  const linhas: string[] = [];
  linhas.push(`📊 *Relatório de ${nomeMes}/${ano}*`);
  linhas.push("");

  for (const area of AREAS) {
    const resumo = porArea.get(area);
    if (!resumo) continue;

    linhas.push(`*${NOMES_AREA[area]}*`);
    // "Despesas" sempre aparece (mesmo zerada) — é o campo principal de toda
    // área. Receita/colhido só aparecem quando têm dado, pra não sobrar
    // "nenhum registro" ocupando espaço à toa.
    linhas.push(`Despesas: ${formatarMoeda(resumo.despesaTotal)}`);
    if (resumo.receitaTotal > 0) {
      linhas.push(`Receita (vendas): ${formatarMoeda(resumo.receitaTotal)}`);
    }
    if (resumo.colhidoPorUnidade.size > 0) {
      linhas.push(`Colhido: ${formatarPartesUnidade(resumo.colhidoPorUnidade)}`);
    }

    linhas.push("");
    linhas.push("Por categoria:");
    for (const [categoria, resumoCat] of resumo.porCategoria) {
      const detalhado = resumoCat.quantidadeRegistros > 1;
      let linha = `• ${NOMES_CATEGORIA[categoria]}: ${pluralRegistro(resumoCat.quantidadeRegistros)}`;
      // Com mais de um registro, o valor/quantidade agregado some daqui —
      // fica só no detalhamento por item + total, pra não repetir a mesma
      // informação duas vezes.
      if (!detalhado) {
        if (resumoCat.valorTotal > 0) linha += ` — ${formatarMoeda(resumoCat.valorTotal)}`;
        if (resumoCat.quantidadesPorUnidade.size > 0) {
          linha += ` (${formatarPartesUnidade(resumoCat.quantidadesPorUnidade)})`;
        }
      }
      linhas.push(linha);
      if (detalhado) {
        linhas.push(...formatarLinhasItens(resumoCat.entradas));
        if (resumoCat.valorTotal > 0) {
          linhas.push(`  Total: ${formatarMoeda(resumoCat.valorTotal)}`);
        }
      }
    }
    linhas.push("");
  }

  const geral = montarResumoGeral(porArea);
  linhas.push("━━━━━━━━━━━━━━━");
  linhas.push("📋 *Resumo geral*");
  linhas.push(`Despesa total: ${formatarMoeda(geral.despesaTotal)}`);
  linhas.push(`Receita total: ${formatarMoeda(geral.receitaTotal)}`);
  linhas.push(`💰 *Saldo: ${formatarMoeda(geral.receitaTotal - geral.despesaTotal)}*`);

  return linhas.join("\n").trimEnd();
}

export async function gerarRelatorioTexto(offsetMeses: number): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const entries = await buscarEntriesPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, entries);
}
