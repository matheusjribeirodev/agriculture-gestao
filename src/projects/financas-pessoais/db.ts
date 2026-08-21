import { supabase } from "../../db";

export type Tipo = "despesa" | "receita";

export const TIPOS: Tipo[] = ["despesa", "receita"];

export type Categoria =
  | "moradia"
  | "alimentacao"
  | "transporte"
  | "saude"
  | "assinaturas"
  | "lazer"
  | "cartao_fatura"
  | "salario"
  | "extra"
  | "outro";

export const CATEGORIAS: Categoria[] = [
  "moradia",
  "alimentacao",
  "transporte",
  "saude",
  "assinaturas",
  "lazer",
  "cartao_fatura",
  "salario",
  "extra",
  "outro",
];

// Categorias válidas por tipo — espelha o CHECK constraint da tabela
// `lancamentos_pessoais` no Supabase (mesmo padrão de `CATEGORIAS_POR_AREA`
// na gestão rural).
export const CATEGORIAS_POR_TIPO: Record<Tipo, Categoria[]> = {
  despesa: ["moradia", "alimentacao", "transporte", "saude", "assinaturas", "lazer", "cartao_fatura", "outro"],
  receita: ["salario", "extra", "outro"],
};

export type FormaPagamento = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";

export const FORMAS_PAGAMENTO: FormaPagamento[] = ["pix", "dinheiro", "cartao_credito", "cartao_debito"];

export interface LancamentoParaSalvar {
  data: string;
  tipo: Tipo;
  categoria: Categoria;
  valor: number;
  descricao: string | null;
  forma_pagamento: FormaPagamento | null;
  mensagem_original: string;
}

export interface Lancamento extends LancamentoParaSalvar {
  id: number;
  criado_em: string;
}

// `numeric` do Postgres volta do PostgREST como string — sem essa conversão,
// somas em cima de `valor` virariam concatenação de texto em vez de soma
// (mesmo cuidado já tomado em gestao-rural/db.ts).
function mapLancamento(row: Record<string, unknown>): Lancamento {
  return {
    ...(row as unknown as Lancamento),
    valor: Number(row.valor),
  };
}

export async function inserirLancamento(dados: LancamentoParaSalvar): Promise<number> {
  const { data, error } = await supabase
    .from("lancamentos_pessoais")
    .insert({
      data: dados.data,
      tipo: dados.tipo,
      categoria: dados.categoria,
      valor: dados.valor,
      descricao: dados.descricao,
      forma_pagamento: dados.forma_pagamento,
      mensagem_original: dados.mensagem_original,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Erro ao inserir lançamento: ${error.message}`);
  return data.id as number;
}

export async function buscarLancamentosPorPeriodo(dataInicio: string, dataFim: string): Promise<Lancamento[]> {
  const { data, error } = await supabase
    .from("lancamentos_pessoais")
    .select("*")
    .gte("data", dataInicio)
    .lte("data", dataFim)
    .order("data", { ascending: true });
  if (error) throw new Error(`Erro ao buscar lançamentos: ${error.message}`);
  return (data ?? []).map(mapLancamento);
}

export interface FiltroPeriodo {
  inicio: string;
  fim: string;
  categoria?: Categoria;
}

async function buscarLancamentosFiltrados(filtro: FiltroPeriodo, tipo?: Tipo): Promise<Lancamento[]> {
  let query = supabase
    .from("lancamentos_pessoais")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim);
  if (filtro.categoria) query = query.eq("categoria", filtro.categoria);
  if (tipo) query = query.eq("tipo", tipo);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao consultar lançamentos: ${error.message}`);
  return (data ?? []).map(mapLancamento);
}

export interface ValorPorCategoria {
  categoria: Categoria;
  total: number;
  registros: number;
}

export interface ResultadoValores {
  total: number;
  quantidadeRegistros: number;
  porCategoria: ValorPorCategoria[];
}

async function consultarPorTipo(filtro: FiltroPeriodo, tipo: Tipo): Promise<ResultadoValores> {
  const lancamentos = await buscarLancamentosFiltrados(filtro, tipo);

  const porCategoriaMap = new Map<Categoria, ValorPorCategoria>();
  for (const l of lancamentos) {
    if (!porCategoriaMap.has(l.categoria)) {
      porCategoriaMap.set(l.categoria, { categoria: l.categoria, total: 0, registros: 0 });
    }
    const cat = porCategoriaMap.get(l.categoria)!;
    cat.total += l.valor;
    cat.registros += 1;
  }

  const porCategoria = [...porCategoriaMap.values()].sort((a, b) => b.total - a.total);

  return {
    total: porCategoria.reduce((soma, c) => soma + c.total, 0),
    quantidadeRegistros: porCategoria.reduce((soma, c) => soma + c.registros, 0),
    porCategoria,
  };
}

export function consultarGastos(filtro: FiltroPeriodo): Promise<ResultadoValores> {
  return consultarPorTipo(filtro, "despesa");
}

export function consultarReceitas(filtro: FiltroPeriodo): Promise<ResultadoValores> {
  return consultarPorTipo(filtro, "receita");
}

export interface ValorPorFormaPagamento {
  formaPagamento: FormaPagamento;
  total: number;
  registros: number;
}

export async function consultarPorFormaPagamento(filtro: { inicio: string; fim: string }): Promise<ValorPorFormaPagamento[]> {
  const { data, error } = await supabase
    .from("lancamentos_pessoais")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim)
    .eq("tipo", "despesa")
    .not("forma_pagamento", "is", null);
  if (error) throw new Error(`Erro ao consultar forma de pagamento: ${error.message}`);
  const lancamentos = (data ?? []).map(mapLancamento);

  const porFormaMap = new Map<FormaPagamento, ValorPorFormaPagamento>();
  for (const l of lancamentos) {
    const forma = l.forma_pagamento as FormaPagamento;
    if (!porFormaMap.has(forma)) {
      porFormaMap.set(forma, { formaPagamento: forma, total: 0, registros: 0 });
    }
    const item = porFormaMap.get(forma)!;
    item.total += l.valor;
    item.registros += 1;
  }

  return [...porFormaMap.values()].sort((a, b) => b.total - a.total);
}

export async function consultarRegistros(filtro: FiltroPeriodo & { tipo?: Tipo; limite?: number }): Promise<Lancamento[]> {
  const limite = filtro.limite && filtro.limite > 0 ? Math.min(filtro.limite, 100) : 20;

  let query = supabase
    .from("lancamentos_pessoais")
    .select("*")
    .gte("data", filtro.inicio)
    .lte("data", filtro.fim)
    .order("data", { ascending: false })
    .limit(limite);
  if (filtro.categoria) query = query.eq("categoria", filtro.categoria);
  if (filtro.tipo) query = query.eq("tipo", filtro.tipo);

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao consultar registros: ${error.message}`);
  return (data ?? []).map(mapLancamento);
}

export async function listarRecentes(limite = 10): Promise<Lancamento[]> {
  const { data, error } = await supabase
    .from("lancamentos_pessoais")
    .select("*")
    .order("id", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`Erro ao listar lançamentos recentes: ${error.message}`);
  return (data ?? []).map(mapLancamento);
}

export async function excluirPorId(id: number): Promise<boolean> {
  const { data, error } = await supabase.from("lancamentos_pessoais").delete().eq("id", id).select("id");
  if (error) throw new Error(`Erro ao excluir lançamento: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
