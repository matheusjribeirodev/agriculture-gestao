import { buscarEntriesPorPeriodo, AREAS, type Entry, type Categoria, type Area } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarMoeda, formatarQuantidade, formatarDataBR } from "../../format";

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
  porCategoria: Map<Categoria, ResumoCategoria>;
}

export function montarResumoPorArea(entries: Entry[]): Map<Area, ResumoArea> {
  const porArea = new Map<Area, ResumoArea>();

  for (const entry of entries) {
    if (!porArea.has(entry.area)) {
      porArea.set(entry.area, {
        despesaTotal: 0,
        receitaTotal: 0,
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
}

export function montarResumoGeral(porArea: Map<Area, ResumoArea>): ResumoGeral {
  let despesaTotal = 0;
  let receitaTotal = 0;

  for (const resumo of porArea.values()) {
    despesaTotal += resumo.despesaTotal;
    receitaTotal += resumo.receitaTotal;
  }

  return { despesaTotal, receitaTotal };
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
function formatarBlocoCategorias(categorias: [Categoria, ResumoCategoria][]): string[] {
  const linhas: string[] = [];
  for (const [categoria, resumoCat] of categorias) {
    const detalhado = resumoCat.quantidadeRegistros > 1;
    const entrada = resumoCat.entradas[0];
    // Com um só registro, mostra a data dele no lugar de "1 registro" (já
    // é óbvio que é um só) — com mais de um, o valor/quantidade agregado
    // some daqui e some junto o "N registros", já que o detalhamento por
    // item (com data em cada linha) + total abaixo cobre isso melhor.
    let linha = detalhado
      ? `• ${NOMES_CATEGORIA[categoria]}: ${pluralRegistro(resumoCat.quantidadeRegistros)}`
      : `• ${NOMES_CATEGORIA[categoria]}: ${formatarDataBR(entrada.data)}`;
    if (!detalhado) {
      if (entrada.item) linha += ` — ${entrada.item}`;
      if (resumoCat.valorTotal > 0) linha += ` — ${formatarMoeda(resumoCat.valorTotal)}`;
      if (resumoCat.quantidadesPorUnidade.size > 0) {
        linha += ` (${formatarPartesUnidade(resumoCat.quantidadesPorUnidade)})`;
      }
      if (entrada.local) linha += ` — ${entrada.local}`;
    }
    linhas.push(linha);
    if (detalhado) {
      linhas.push(...formatarLinhasItens(resumoCat.entradas));
      if (resumoCat.valorTotal > 0) {
        linhas.push(`  Total: ${formatarMoeda(resumoCat.valorTotal)}`);
      }
    }
  }
  return linhas;
}

function formatarLinhasItens(entradas: Entry[]): string[] {
  return entradas.map((entrada) => {
    const partes = [formatarDataBR(entrada.data), entrada.item ?? "(sem item)"];
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
    // área. Receita só aparece quando tem dado, pra não sobrar "nenhum
    // registro" ocupando espaço à toa.
    linhas.push(`Despesas: ${formatarMoeda(resumo.despesaTotal)}`);
    if (resumo.receitaTotal > 0) {
      linhas.push(`Receita (vendas): ${formatarMoeda(resumo.receitaTotal)}`);
    }

    // Despesa e receita (venda) nunca aparecem no mesmo bloco — misturar as
    // duas sob um "Por categoria" único deixa parecer que tudo é do mesmo
    // tipo de valor, quando na verdade um é gasto e o outro é dinheiro
    // entrando.
    const categoriasDespesa = [...resumo.porCategoria].filter(([categoria]) => categoria !== "venda");
    const categoriasReceita = [...resumo.porCategoria].filter(([categoria]) => categoria === "venda");

    if (categoriasDespesa.length > 0) {
      linhas.push("");
      linhas.push("Despesas por categoria:");
      linhas.push(...formatarBlocoCategorias(categoriasDespesa));
    }
    if (categoriasReceita.length > 0) {
      linhas.push("");
      linhas.push("Receita por categoria:");
      linhas.push(...formatarBlocoCategorias(categoriasReceita));
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
