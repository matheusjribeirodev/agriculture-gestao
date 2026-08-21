import { buscarLancamentosPorPeriodo, type Lancamento, type Categoria } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda } from "../../format";

interface ResumoCategoria {
  valorTotal: number;
  quantidadeRegistros: number;
}

export interface ResumoFinancas {
  despesaTotal: number;
  receitaTotal: number;
  porCategoriaDespesa: Map<Categoria, ResumoCategoria>;
  porCategoriaReceita: Map<Categoria, ResumoCategoria>;
  porFormaPagamento: Map<string, number>;
}

export function montarResumo(lancamentos: Lancamento[]): ResumoFinancas {
  const resumo: ResumoFinancas = {
    despesaTotal: 0,
    receitaTotal: 0,
    porCategoriaDespesa: new Map(),
    porCategoriaReceita: new Map(),
    porFormaPagamento: new Map(),
  };

  for (const l of lancamentos) {
    const mapaCategoria = l.tipo === "despesa" ? resumo.porCategoriaDespesa : resumo.porCategoriaReceita;
    if (!mapaCategoria.has(l.categoria)) {
      mapaCategoria.set(l.categoria, { valorTotal: 0, quantidadeRegistros: 0 });
    }
    const cat = mapaCategoria.get(l.categoria)!;
    cat.valorTotal += l.valor;
    cat.quantidadeRegistros += 1;

    if (l.tipo === "despesa") {
      resumo.despesaTotal += l.valor;
      if (l.forma_pagamento) {
        resumo.porFormaPagamento.set(l.forma_pagamento, (resumo.porFormaPagamento.get(l.forma_pagamento) ?? 0) + l.valor);
      }
    } else {
      resumo.receitaTotal += l.valor;
    }
  }

  return resumo;
}

function linhasPorCategoria(mapa: Map<Categoria, ResumoCategoria>): string[] {
  return [...mapa.entries()]
    .sort((a, b) => b[1].valorTotal - a[1].valorTotal)
    .map(([categoria, r]) => `- ${categoria}: ${formatarMoeda(r.valorTotal)} (${r.quantidadeRegistros} registro(s))`);
}

function gerarTexto(ano: number, mes: number, lancamentos: Lancamento[]): string {
  const nomeMes = NOMES_MES[mes - 1];

  if (lancamentos.length === 0) {
    return `Nenhum lançamento encontrado em ${nomeMes}/${ano}.`;
  }

  const resumo = montarResumo(lancamentos);
  const linhas: string[] = [`💰 Finanças pessoais — ${nomeMes}/${ano}`, ""];

  linhas.push(`Despesas: ${formatarMoeda(resumo.despesaTotal)}`);
  linhas.push(...linhasPorCategoria(resumo.porCategoriaDespesa));
  linhas.push("");

  linhas.push(`Receitas: ${formatarMoeda(resumo.receitaTotal)}`);
  linhas.push(...linhasPorCategoria(resumo.porCategoriaReceita));
  linhas.push("");

  if (resumo.porFormaPagamento.size > 0) {
    linhas.push("Por forma de pagamento:");
    for (const [forma, total] of [...resumo.porFormaPagamento.entries()].sort((a, b) => b[1] - a[1])) {
      linhas.push(`- ${forma}: ${formatarMoeda(total)}`);
    }
    linhas.push("");
  }

  linhas.push(`Saldo: ${formatarMoeda(resumo.receitaTotal - resumo.despesaTotal)}`);

  return linhas.join("\n").trimEnd();
}

export async function gerarRelatorioTexto(offsetMeses: number): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const lancamentos = await buscarLancamentosPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, lancamentos);
}
