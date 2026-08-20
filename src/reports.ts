import { buscarEntriesPorPeriodo, consultarUsoIA, type Entry, type Categoria } from "./db";

export const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarDataLocal(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function obterIntervaloMes(offsetMeses: number): { inicio: string; fim: string; ano: number; mes: number } {
  const agora = new Date();
  let ano = agora.getFullYear();
  let mes = agora.getMonth() + 1 + offsetMeses;

  while (mes < 1) {
    mes += 12;
    ano -= 1;
  }
  while (mes > 12) {
    mes -= 12;
    ano += 1;
  }

  const ultimoDia = new Date(ano, mes, 0).getDate();

  return {
    inicio: formatarDataLocal(ano, mes, 1),
    fim: formatarDataLocal(ano, mes, ultimoDia),
    ano,
    mes,
  };
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Custo de IA é cobrado em dólar pela Anthropic/Google — nunca formatar como
// R$, mesmo que o resto do bot trabalhe em reais.
function formatarDolar(valor: number): string {
  return valor.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function formatarQuantidade(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export interface ResumoCategoria {
  quantidadeRegistros: number;
  custoTotal: number;
  quantidadesPorUnidade: Map<string, number>;
}

export function montarResumo(entries: Entry[]): {
  totalGasto: number;
  colhidoPorUnidade: Map<string, number>;
  porCategoria: Map<Categoria, ResumoCategoria>;
} {
  let totalGasto = 0;
  const colhidoPorUnidade = new Map<string, number>();
  const porCategoria = new Map<Categoria, ResumoCategoria>();

  for (const entry of entries) {
    if (entry.categoria !== "venda" && entry.custo !== null) {
      totalGasto += entry.custo;
    }

    if (entry.categoria === "colheita" && entry.quantidade !== null && entry.unidade) {
      colhidoPorUnidade.set(
        entry.unidade,
        (colhidoPorUnidade.get(entry.unidade) ?? 0) + entry.quantidade,
      );
    }

    if (!porCategoria.has(entry.categoria)) {
      porCategoria.set(entry.categoria, {
        quantidadeRegistros: 0,
        custoTotal: 0,
        quantidadesPorUnidade: new Map(),
      });
    }
    const resumoCat = porCategoria.get(entry.categoria)!;
    resumoCat.quantidadeRegistros += 1;
    if (entry.custo !== null) {
      resumoCat.custoTotal += entry.custo;
    }
    if (entry.quantidade !== null && entry.unidade) {
      resumoCat.quantidadesPorUnidade.set(
        entry.unidade,
        (resumoCat.quantidadesPorUnidade.get(entry.unidade) ?? 0) + entry.quantidade,
      );
    }
  }

  return { totalGasto, colhidoPorUnidade, porCategoria };
}

function gerarTexto(ano: number, mes: number, entries: Entry[]): string {
  const nomeMes = NOMES_MES[mes - 1];

  if (entries.length === 0) {
    return `Nenhum registro encontrado em ${nomeMes}/${ano}.`;
  }

  const { totalGasto, colhidoPorUnidade, porCategoria } = montarResumo(entries);

  const linhas: string[] = [];
  linhas.push(`Relatório de ${nomeMes}/${ano}`);
  linhas.push("");
  linhas.push(`Total gasto: ${formatarMoeda(totalGasto)}`);

  if (colhidoPorUnidade.size > 0) {
    const partes = [...colhidoPorUnidade.entries()].map(
      ([unidade, total]) => `${formatarQuantidade(total)} ${unidade}`,
    );
    linhas.push(`Total colhido: ${partes.join(", ")}`);
  } else {
    linhas.push("Total colhido: nenhum registro de colheita");
  }

  linhas.push("");
  linhas.push("Por categoria:");
  for (const [categoria, resumo] of porCategoria) {
    let linha = `- ${categoria}: ${resumo.quantidadeRegistros} registro(s)`;
    if (resumo.custoTotal > 0) {
      linha += `, ${formatarMoeda(resumo.custoTotal)}`;
    }
    if (resumo.quantidadesPorUnidade.size > 0) {
      const partes = [...resumo.quantidadesPorUnidade.entries()].map(
        ([unidade, total]) => `${formatarQuantidade(total)} ${unidade}`,
      );
      linha += ` (${partes.join(", ")})`;
    }
    linhas.push(linha);
  }

  return linhas.join("\n");
}

export function gerarRelatorioMesAtual(): string {
  const { inicio, fim, ano, mes } = obterIntervaloMes(0);
  const entries = buscarEntriesPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, entries);
}

export function gerarRelatorioMesPassado(): string {
  const { inicio, fim, ano, mes } = obterIntervaloMes(-1);
  const entries = buscarEntriesPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, entries);
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function gerarTextoUsoIA(offsetMeses: number): string {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const resumos = consultarUsoIA({ inicio, fim });
  const nomeMes = NOMES_MES[mes - 1];

  if (resumos.length === 0) {
    return `Nenhum uso de IA registrado em ${nomeMes}/${ano}.`;
  }

  const linhas: string[] = [`📊 Uso de IA — ${nomeMes}/${ano}`, ""];

  // Uma mensagem do produtor pode gerar mais de uma chamada de IA (o
  // roteador pode encadear rodadas de ferramentas antes de responder).
  const totalChamadas = resumos.reduce((soma, r) => soma + r.chamadas, 0);
  linhas.push(`Chamadas de IA: ${totalChamadas}`, "");

  let custoTotal = 0;
  let custoIndisponivel = false;

  for (const resumo of resumos) {
    const nomeProvider = resumo.provider === "gemini" ? "Gemini" : "Claude";
    linhas.push(`${nomeProvider}:`);
    linhas.push(`${resumo.chamadas} chamada(s), ${formatarNumero(resumo.tokensInput + resumo.tokensOutput)} tokens`);
    if (resumo.custoEstimado !== null) {
      custoTotal += resumo.custoEstimado;
      linhas.push(`Custo estimado: ${formatarDolar(resumo.custoEstimado)}`);
    } else {
      custoIndisponivel = true;
    }
    linhas.push("");
  }

  if (custoIndisponivel) {
    linhas.push(
      "⚠️ Custo estimado incompleto — falta configurar o preço de algum provider no .env (ver README).",
    );
  } else {
    linhas.push(`Custo estimado total: ${formatarDolar(custoTotal)}`);
  }

  return linhas.join("\n").trimEnd();
}

export function gerarRelatorioUsoIAMesAtual(): string {
  return gerarTextoUsoIA(0);
}

export function gerarRelatorioUsoIAMesPassado(): string {
  return gerarTextoUsoIA(-1);
}
