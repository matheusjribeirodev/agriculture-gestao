import { supabase } from "../../db";

export type Area = "cafe" | "propriedade" | "outro";

export const AREAS: Area[] = ["cafe", "propriedade", "outro"];

export type Categoria =
  | "adubacao"
  | "colheita"
  | "poda"
  | "defensivo"
  | "mao_de_obra"
  | "venda"
  | "outro"
  | "manutencao"
  | "combustivel"
  | "energia"
  | "agua"
  | "insumo";

export const CATEGORIAS: Categoria[] = [
  "adubacao",
  "colheita",
  "poda",
  "defensivo",
  "mao_de_obra",
  "venda",
  "outro",
  "manutencao",
  "combustivel",
  "energia",
  "agua",
  "insumo",
];

// Categorias válidas por área — usado tanto para orientar a IA (prompt/schema
// da ferramenta) quanto para corrigir uma combinação inválida antes de salvar.
// Espelha os CHECK constraints da tabela `entries` no Supabase.
export const CATEGORIAS_POR_AREA: Record<Area, Categoria[]> = {
  cafe: ["adubacao", "colheita", "poda", "defensivo", "mao_de_obra", "venda", "outro"],
  propriedade: ["manutencao", "combustivel", "energia", "agua", "insumo", "mao_de_obra", "venda", "outro"],
  outro: ["mao_de_obra", "venda", "outro"],
};

export interface EntradaParaSalvar {
  data: string;
  area: Area;
  categoria: Categoria;
  item: string | null;
  quantidade: number | null;
  unidade: string | null;
  custo: number | null;
  local: string | null;
  observacao: string | null;
  mensagem_original: string;
}

export interface Entry extends EntradaParaSalvar {
  id: number;
  criado_em: string;
}

// `numeric` do Postgres volta do PostgREST como string (evita perda de
// precisão) — sem essa conversão, somas em cima de `custo`/`quantidade`
// virariam concatenação de texto em vez de soma.
function mapEntry(row: Record<string, unknown>): Entry {
  return {
    ...(row as unknown as Entry),
    quantidade: row.quantidade === null ? null : Number(row.quantidade),
    custo: row.custo === null ? null : Number(row.custo),
  };
}

export async function inserirEntry(entrada: EntradaParaSalvar): Promise<number> {
  const { data, error } = await supabase
    .from("entries")
    .insert({
      data: entrada.data,
      area: entrada.area,
      categoria: entrada.categoria,
      item: entrada.item,
      quantidade: entrada.quantidade,
      unidade: entrada.unidade,
      custo: entrada.custo,
      local: entrada.local,
      observacao: entrada.observacao,
      mensagem_original: entrada.mensagem_original,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Erro ao inserir registro: ${error.message}`);
  return data.id as number;
}

export async function buscarEntriesPorPeriodo(dataInicio: string, dataFim: string): Promise<Entry[]> {
  const { data, error } = await supabase
    .from("entries")
    .select("*")
    .gte("data", dataInicio)
    .lte("data", dataFim)
    .order("data", { ascending: true });
  if (error) throw new Error(`Erro ao buscar registros: ${error.message}`);
  return (data ?? []).map(mapEntry);
}

export interface FiltroPeriodo {
  inicio: string;
  fim: string;
  categoria?: Categoria;
  local?: string;
  area?: Area;
}

// Busca as entries que batem com o filtro comum (período + categoria/local/
// área opcionais), já convertidas — base compartilhada pelas consultas de
// gastos, produção, vendas e registros abaixo (que antes eram queries SQL
// com GROUP BY; aqui buscamos as linhas e agregamos em JS).
async function buscarEntriesFiltradas(filtro: FiltroPeriodo, excluirVenda = false): Promise<Entry[]> {
  let query = supabase
    .from("entries")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim);
  if (filtro.categoria) query = query.eq("categoria", filtro.categoria);
  if (filtro.local) query = query.eq("local", filtro.local);
  if (filtro.area) query = query.eq("area", filtro.area);
  if (excluirVenda) query = query.neq("categoria", "venda");

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao consultar registros: ${error.message}`);
  return (data ?? []).map(mapEntry);
}

export interface GastoPorCategoria {
  area: Area;
  categoria: Categoria;
  total: number;
  registros: number;
}

export interface GastoPorArea {
  area: Area;
  total: number;
  registros: number;
}

export interface ResultadoGastos {
  totalGasto: number;
  quantidadeRegistros: number;
  porArea: GastoPorArea[];
  porCategoria: GastoPorCategoria[];
}

export async function consultarGastos(filtro: FiltroPeriodo): Promise<ResultadoGastos> {
  const entries = await buscarEntriesFiltradas(filtro, true);

  const porCategoriaMap = new Map<string, GastoPorCategoria>();
  const porAreaMap = new Map<Area, GastoPorArea>();

  for (const e of entries) {
    const chaveCategoria = `${e.area}|${e.categoria}`;
    if (!porCategoriaMap.has(chaveCategoria)) {
      porCategoriaMap.set(chaveCategoria, { area: e.area, categoria: e.categoria, total: 0, registros: 0 });
    }
    const cat = porCategoriaMap.get(chaveCategoria)!;
    cat.total += e.custo ?? 0;
    cat.registros += 1;

    if (!porAreaMap.has(e.area)) {
      porAreaMap.set(e.area, { area: e.area, total: 0, registros: 0 });
    }
    const ar = porAreaMap.get(e.area)!;
    ar.total += e.custo ?? 0;
    ar.registros += 1;
  }

  const porCategoria = [...porCategoriaMap.values()].sort(
    (a, b) => a.area.localeCompare(b.area) || b.total - a.total,
  );
  const porArea = [...porAreaMap.values()].sort((a, b) => b.total - a.total);

  return {
    totalGasto: porArea.reduce((soma, a) => soma + a.total, 0),
    quantidadeRegistros: porArea.reduce((soma, a) => soma + a.registros, 0),
    porArea,
    porCategoria,
  };
}

export interface QuantidadePorUnidade {
  unidade: string;
  quantidade: number;
}

export interface QuantidadePorLocal {
  local: string;
  unidade: string;
  quantidade: number;
}

export interface ProducaoPorArea {
  area: Area;
  unidade: string;
  quantidade: number;
}

export interface MelhorDiaColheita {
  data: string;
  unidade: string;
  quantidade: number;
}

export interface ResultadoProducao {
  totalPorUnidade: QuantidadePorUnidade[];
  porArea: ProducaoPorArea[];
  porLocal: QuantidadePorLocal[];
  diasComColheita: number;
  melhorDia: MelhorDiaColheita | null;
}

export async function consultarProducao(filtro: Omit<FiltroPeriodo, "categoria">): Promise<ResultadoProducao> {
  let query = supabase
    .from("entries")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim)
    .eq("categoria", "colheita")
    .not("unidade", "is", null)
    .not("quantidade", "is", null);
  if (filtro.local) query = query.eq("local", filtro.local);
  if (filtro.area) query = query.eq("area", filtro.area);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao consultar produção: ${error.message}`);
  const entries = (data ?? []).map(mapEntry);

  const totalPorUnidadeMap = new Map<string, number>();
  const porAreaMap = new Map<string, ProducaoPorArea>();
  const porLocalMap = new Map<string, QuantidadePorLocal>();
  const diasSet = new Set<string>();
  const melhorDiaMap = new Map<string, MelhorDiaColheita>();

  for (const e of entries) {
    const quantidade = e.quantidade as number;
    const unidade = e.unidade as string;

    totalPorUnidadeMap.set(unidade, (totalPorUnidadeMap.get(unidade) ?? 0) + quantidade);

    const chaveArea = `${e.area}|${unidade}`;
    porAreaMap.set(chaveArea, {
      area: e.area,
      unidade,
      quantidade: (porAreaMap.get(chaveArea)?.quantidade ?? 0) + quantidade,
    });

    diasSet.add(e.data);

    if (e.local) {
      const chaveLocal = `${e.local}|${unidade}`;
      porLocalMap.set(chaveLocal, {
        local: e.local,
        unidade,
        quantidade: (porLocalMap.get(chaveLocal)?.quantidade ?? 0) + quantidade,
      });
    }

    const chaveDia = `${e.data}|${unidade}`;
    melhorDiaMap.set(chaveDia, {
      data: e.data,
      unidade,
      quantidade: (melhorDiaMap.get(chaveDia)?.quantidade ?? 0) + quantidade,
    });
  }

  const totalPorUnidade = [...totalPorUnidadeMap.entries()]
    .map(([unidade, quantidade]) => ({ unidade, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);
  const porArea = [...porAreaMap.values()].sort((a, b) => b.quantidade - a.quantidade);
  const porLocal = [...porLocalMap.values()].sort((a, b) => b.quantidade - a.quantidade);
  const melhorDia = [...melhorDiaMap.values()].sort((a, b) => b.quantidade - a.quantidade)[0] ?? null;

  return { totalPorUnidade, porArea, porLocal, diasComColheita: diasSet.size, melhorDia };
}

export interface VendaPorArea {
  area: Area;
  total: number;
  registros: number;
}

export interface ResultadoVendas {
  valorTotal: number;
  quantidadeRegistros: number;
  porArea: VendaPorArea[];
  porUnidade: QuantidadePorUnidade[];
}

export async function consultarVendas(filtro: { inicio: string; fim: string; area?: Area }): Promise<ResultadoVendas> {
  let query = supabase
    .from("entries")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim)
    .eq("categoria", "venda");
  if (filtro.area) query = query.eq("area", filtro.area);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao consultar vendas: ${error.message}`);
  const entries = (data ?? []).map(mapEntry);

  const porUnidadeMap = new Map<string, number>();
  const porAreaMap = new Map<Area, VendaPorArea>();

  for (const e of entries) {
    if (e.unidade && e.quantidade !== null) {
      porUnidadeMap.set(e.unidade, (porUnidadeMap.get(e.unidade) ?? 0) + e.quantidade);
    }
    if (!porAreaMap.has(e.area)) {
      porAreaMap.set(e.area, { area: e.area, total: 0, registros: 0 });
    }
    const ar = porAreaMap.get(e.area)!;
    ar.total += e.custo ?? 0;
    ar.registros += 1;
  }

  const porUnidade = [...porUnidadeMap.entries()]
    .map(([unidade, quantidade]) => ({ unidade, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);
  const porArea = [...porAreaMap.values()].sort((a, b) => b.total - a.total);

  return {
    valorTotal: porArea.reduce((soma, a) => soma + a.total, 0),
    quantidadeRegistros: porArea.reduce((soma, a) => soma + a.registros, 0),
    porArea,
    porUnidade,
  };
}

export async function consultarRegistros(filtro: FiltroPeriodo & { limite?: number }): Promise<Entry[]> {
  const limite = filtro.limite && filtro.limite > 0 ? Math.min(filtro.limite, 100) : 20;

  let query = supabase
    .from("entries")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim)
    .order("data", { ascending: false })
    .limit(limite);
  if (filtro.categoria) query = query.eq("categoria", filtro.categoria);
  if (filtro.local) query = query.eq("local", filtro.local);
  if (filtro.area) query = query.eq("area", filtro.area);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao consultar registros: ${error.message}`);
  return (data ?? []).map(mapEntry);
}

export async function listarRegistrosRecentes(limite = 10): Promise<Entry[]> {
  const { data, error } = await supabase
    .from("entries")
    .select("*")
    .order("id", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`Erro ao listar registros recentes: ${error.message}`);
  return (data ?? []).map(mapEntry);
}

export async function excluirRegistroPorId(id: number): Promise<boolean> {
  const { data, error } = await supabase.from("entries").delete().eq("id", id).select("id");
  if (error) throw new Error(`Erro ao excluir registro: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
