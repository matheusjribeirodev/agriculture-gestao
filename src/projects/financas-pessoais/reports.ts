import { buscarLancamentosPorPeriodo, type Lancamento, type Categoria, type FormaPagamento } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda, formatarDataBR } from "../../format";

// Usado tanto pelo relatório em texto quanto pelo PDF (que importa daqui em
// vez de manter sua própria cópia) — mesmo padrão de gestao-rural/reports.ts.
export const NOMES_CATEGORIA: Record<Categoria, string> = {
  moradia: "Moradia",
  alimentacao: "Alimentação",
  transporte: "Transporte",
  saude: "Saúde",
  assinaturas: "Assinaturas",
  lazer: "Lazer",
  cartao_fatura: "Fatura do cartão",
  salario: "Salário",
  extra: "Extra",
  outro: "Outro",
};

export const NOMES_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
};

interface ResumoCategoria {
  quantidadeRegistros: number;
  valorTotal: number;
  // Lançamentos individuais dessa categoria — usado pra detalhar por item no
  // relatório em texto quando há mais de um registro (ver `gerarTexto`).
  lancamentos: Lancamento[];
}

export interface ResumoFinancas {
  despesaTotal: number;
  receitaTotal: number;
  porCategoriaDespesa: Map<Categoria, ResumoCategoria>;
  porCategoriaReceita: Map<Categoria, ResumoCategoria>;
  porFormaPagamento: Map<FormaPagamento, number>;
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
      mapaCategoria.set(l.categoria, { valorTotal: 0, quantidadeRegistros: 0, lancamentos: [] });
    }
    const cat = mapaCategoria.get(l.categoria)!;
    cat.valorTotal += l.valor;
    cat.quantidadeRegistros += 1;
    cat.lancamentos.push(l);

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

function pluralRegistro(n: number): string {
  return n === 1 ? "1 registro" : `${n} registros`;
}

// Uma categoria com só um registro já é clara na linha de resumo — o
// detalhamento por item só aparece (e só ajuda) quando há mais de um
// registro na mesma categoria, que é quando "2 registros, R$ X" esconde o
// que cada um foi de fato.
function formatarLinhasItens(lancamentos: Lancamento[]): string[] {
  return lancamentos.map((l) => {
    const partes = [formatarDataBR(l.data), l.descricao ?? "(sem descrição)", formatarMoeda(l.valor)];
    if (l.forma_pagamento) partes.push(NOMES_FORMA_PAGAMENTO[l.forma_pagamento]);
    return `  ↳ ${partes.join(" — ")}`;
  });
}

function formatarLinhasCategoria(mapa: Map<Categoria, ResumoCategoria>): string[] {
  const linhas: string[] = [];
  const categoriasOrdenadas = [...mapa.entries()].sort((a, b) => b[1].valorTotal - a[1].valorTotal);

  for (const [categoria, resumoCat] of categoriasOrdenadas) {
    const detalhado = resumoCat.quantidadeRegistros > 1;
    // Com um só registro, mostra a data dele no lugar de "1 registro" (já é
    // óbvio que é um só) — com mais de um, o valor agregado some daqui e o
    // detalhamento por item (com data em cada linha) + total abaixo cobre
    // isso melhor.
    let linha = detalhado
      ? `• ${NOMES_CATEGORIA[categoria]}: ${pluralRegistro(resumoCat.quantidadeRegistros)}`
      : `• ${NOMES_CATEGORIA[categoria]}: ${formatarDataBR(resumoCat.lancamentos[0].data)}`;
    if (!detalhado) {
      linha += ` — ${formatarMoeda(resumoCat.valorTotal)}`;
      if (resumoCat.lancamentos[0].descricao) linha += ` — ${resumoCat.lancamentos[0].descricao}`;
      if (resumoCat.lancamentos[0].forma_pagamento) linha += ` — ${NOMES_FORMA_PAGAMENTO[resumoCat.lancamentos[0].forma_pagamento]}`;
    }
    linhas.push(linha);
    if (detalhado) {
      linhas.push(...formatarLinhasItens(resumoCat.lancamentos));
      linhas.push(`  Total: ${formatarMoeda(resumoCat.valorTotal)}`);
    }
  }

  return linhas;
}

function gerarTexto(ano: number, mes: number, lancamentos: Lancamento[]): string {
  const nomeMes = NOMES_MES[mes - 1];

  if (lancamentos.length === 0) {
    return `Nenhum lançamento encontrado em ${nomeMes}/${ano}.`;
  }

  const resumo = montarResumo(lancamentos);
  const linhas: string[] = [];
  linhas.push(`💰 *Relatório de ${nomeMes}/${ano}*`);
  linhas.push("");

  linhas.push("*💸 Despesas*");
  linhas.push(`Total: ${formatarMoeda(resumo.despesaTotal)}`);
  if (resumo.porCategoriaDespesa.size > 0) {
    linhas.push("");
    linhas.push("Por categoria:");
    linhas.push(...formatarLinhasCategoria(resumo.porCategoriaDespesa));
  }
  if (resumo.porFormaPagamento.size > 0) {
    linhas.push("");
    linhas.push("Por forma de pagamento:");
    for (const [forma, total] of [...resumo.porFormaPagamento.entries()].sort((a, b) => b[1] - a[1])) {
      linhas.push(`• ${NOMES_FORMA_PAGAMENTO[forma]}: ${formatarMoeda(total)}`);
    }
  }
  linhas.push("");

  if (resumo.porCategoriaReceita.size > 0) {
    linhas.push("*💵 Receitas*");
    linhas.push(`Total: ${formatarMoeda(resumo.receitaTotal)}`);
    linhas.push("");
    linhas.push("Por categoria:");
    linhas.push(...formatarLinhasCategoria(resumo.porCategoriaReceita));
    linhas.push("");
  }

  linhas.push("━━━━━━━━━━━━━━━");
  linhas.push("📋 *Resumo geral*");
  linhas.push(`Despesa total: ${formatarMoeda(resumo.despesaTotal)}`);
  linhas.push(`Receita total: ${formatarMoeda(resumo.receitaTotal)}`);
  linhas.push(`💰 *Saldo: ${formatarMoeda(resumo.receitaTotal - resumo.despesaTotal)}*`);

  return linhas.join("\n").trimEnd();
}

export async function gerarRelatorioTexto(offsetMeses: number): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const lancamentos = await buscarLancamentosPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, lancamentos);
}
