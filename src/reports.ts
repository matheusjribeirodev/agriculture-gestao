import { buscarEntriesPorPeriodo, consultarUsoIA, AREAS, type Entry, type Categoria, type Area } from "./db";

export const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const NOMES_AREA: Record<Area, string> = {
  cafe: "☕ Café",
  propriedade: "🏡 Propriedade",
  outro: "📦 Outro",
};

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

export async function gerarRelatorioMesAtual(): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(0);
  const entries = await buscarEntriesPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, entries);
}

export async function gerarRelatorioMesPassado(): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(-1);
  const entries = await buscarEntriesPorPeriodo(inicio, fim);
  return gerarTexto(ano, mes, entries);
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

async function gerarTextoUsoIA(offsetMeses: number): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const resumos = await consultarUsoIA({ inicio, fim });
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

export function gerarRelatorioUsoIAMesAtual(): Promise<string> {
  return gerarTextoUsoIA(0);
}

export function gerarRelatorioUsoIAMesPassado(): Promise<string> {
  return gerarTextoUsoIA(-1);
}
