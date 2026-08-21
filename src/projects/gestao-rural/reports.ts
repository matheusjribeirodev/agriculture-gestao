import { buscarEntriesPorPeriodo, AREAS, type Entry, type Categoria, type Area } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda, formatarQuantidade } from "../../format";

export const NOMES_AREA: Record<Area, string> = {
  cafe: "☕ Café",
  propriedade: "🏡 Propriedade",
  outro: "📦 Outro",
};

export interface ResumoCategoria {
  quantidadeRegistros: number;
  // Para categoria "venda" isso é receita; para as demais, despesa.
  valorTotal: number;
  quantidadesPorUnidade: Map<string, number>;
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
      });
    }
    const resumoCat = resumo.porCategoria.get(entry.categoria)!;
    resumoCat.quantidadeRegistros += 1;
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

function gerarTexto(ano: number, mes: number, entries: Entry[]): string {
  const nomeMes = NOMES_MES[mes - 1];

  if (entries.length === 0) {
    return `Nenhum registro encontrado em ${nomeMes}/${ano}.`;
  }

  const porArea = montarResumoPorArea(entries);

  const linhas: string[] = [];
  linhas.push(`Relatório de ${nomeMes}/${ano}`);
  linhas.push("");

  for (const area of AREAS) {
    const resumo = porArea.get(area);
    if (!resumo) continue;

    linhas.push(NOMES_AREA[area]);
    linhas.push(`Despesas: ${formatarMoeda(resumo.despesaTotal)}`);
    if (resumo.receitaTotal > 0) {
      linhas.push(`Receita (vendas): ${formatarMoeda(resumo.receitaTotal)}`);
    }
    linhas.push(
      resumo.colhidoPorUnidade.size > 0
        ? `Colhido: ${formatarPartesUnidade(resumo.colhidoPorUnidade)}`
        : "Colhido: nenhum registro de colheita",
    );

    linhas.push("Por categoria:");
    for (const [categoria, resumoCat] of resumo.porCategoria) {
      let linha = `- ${categoria}: ${resumoCat.quantidadeRegistros} registro(s)`;
      if (resumoCat.valorTotal > 0) {
        const rotulo = categoria === "venda" ? "receita" : "custo";
        linha += `, ${rotulo} ${formatarMoeda(resumoCat.valorTotal)}`;
      }
      if (resumoCat.quantidadesPorUnidade.size > 0) {
        linha += ` (${formatarPartesUnidade(resumoCat.quantidadesPorUnidade)})`;
      }
      linhas.push(linha);
    }
    linhas.push("");
  }

  const geral = montarResumoGeral(porArea);
  linhas.push("Resumo geral");
  linhas.push(`Despesa total: ${formatarMoeda(geral.despesaTotal)}`);
  linhas.push(`Receita total: ${formatarMoeda(geral.receitaTotal)}`);
  linhas.push(`Saldo: ${formatarMoeda(geral.receitaTotal - geral.despesaTotal)}`);

  return linhas.join("\n").trimEnd();
}

export async function gerarRelatorioTexto(offsetMeses: number): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const entries = await buscarEntriesPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, entries);
}
