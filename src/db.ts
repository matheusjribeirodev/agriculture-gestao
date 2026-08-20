import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

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

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "gestao.db");

export const db = new DatabaseSync(DB_PATH);

function colunaExiste(tabela: string, coluna: string): boolean {
  const linhas = db.prepare(`PRAGMA table_info(${tabela})`).all() as unknown as { name: string }[];
  return linhas.some((l) => l.name === coluna);
}

// Migração idempotente: bancos criados antes deste schema têm `talhao` e não
// têm `area`. Bancos novos já nascem com `area`/`local` pelo CREATE TABLE
// abaixo, então essas checagens viram no-op — seguro rodar em todo boot.
function migrarSchemaEntries(): void {
  if (!colunaExiste("entries", "area")) {
    db.exec(`ALTER TABLE entries ADD COLUMN area TEXT NOT NULL DEFAULT 'cafe'`);
  }
  if (colunaExiste("entries", "talhao") && !colunaExiste("entries", "local")) {
    db.exec(`ALTER TABLE entries RENAME COLUMN talhao TO local`);
  } else if (!colunaExiste("entries", "local")) {
    db.exec(`ALTER TABLE entries ADD COLUMN local TEXT`);
  }
}

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT 'cafe',
      categoria TEXT NOT NULL,
      item TEXT,
      quantidade REAL,
      unidade TEXT,
      custo REAL,
      local TEXT,
      observacao TEXT,
      mensagem_original TEXT NOT NULL,
      criado_em TEXT NOT NULL
    )
  `);
  migrarSchemaEntries();

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      modelo TEXT NOT NULL,
      tokens_input INTEGER NOT NULL,
      tokens_output INTEGER NOT NULL,
      custo_estimado REAL,
      criado_em TEXT NOT NULL
    )
  `);
}

export function inserirEntry(entrada: EntradaParaSalvar): number {
  const stmt = db.prepare(`
    INSERT INTO entries
      (data, area, categoria, item, quantidade, unidade, custo, local, observacao, mensagem_original, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const criadoEm = new Date().toISOString();
  const resultado = stmt.run(
    entrada.data,
    entrada.area,
    entrada.categoria,
    entrada.item,
    entrada.quantidade,
    entrada.unidade,
    entrada.custo,
    entrada.local,
    entrada.observacao,
    entrada.mensagem_original,
    criadoEm,
  );
  return Number(resultado.lastInsertRowid);
}

export function buscarEntriesPorPeriodo(dataInicio: string, dataFim: string): Entry[] {
  const stmt = db.prepare(`
    SELECT * FROM entries
    WHERE data >= ? AND data <= ?
    ORDER BY data ASC
  `);
  return stmt.all(dataInicio, dataFim) as unknown as Entry[];
}

export interface FiltroPeriodo {
  inicio: string;
  fim: string;
  categoria?: Categoria;
  local?: string;
  area?: Area;
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

function condicoesFiltro(filtro: FiltroPeriodo): { condicoes: string[]; params: SQLInputValue[] } {
  const condicoes = ["data >= ?", "data <= ?"];
  const params: SQLInputValue[] = [filtro.inicio, filtro.fim];

  if (filtro.categoria) {
    condicoes.push("categoria = ?");
    params.push(filtro.categoria);
  }
  if (filtro.local) {
    condicoes.push("local = ?");
    params.push(filtro.local);
  }
  if (filtro.area) {
    condicoes.push("area = ?");
    params.push(filtro.area);
  }

  return { condicoes, params };
}

export function consultarGastos(filtro: FiltroPeriodo): ResultadoGastos {
  const { condicoes, params } = condicoesFiltro(filtro);
  condicoes.push("categoria != 'venda'");

  const where = condicoes.join(" AND ");

  const porCategoria = db
    .prepare(
      `SELECT area, categoria, COALESCE(SUM(custo), 0) as total, COUNT(*) as registros
       FROM entries WHERE ${where} GROUP BY area, categoria ORDER BY area, total DESC`,
    )
    .all(...params) as unknown as GastoPorCategoria[];

  const porArea = db
    .prepare(
      `SELECT area, COALESCE(SUM(custo), 0) as total, COUNT(*) as registros
       FROM entries WHERE ${where} GROUP BY area ORDER BY total DESC`,
    )
    .all(...params) as unknown as GastoPorArea[];

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

export function consultarProducao(filtro: Omit<FiltroPeriodo, "categoria">): ResultadoProducao {
  const { condicoes, params } = condicoesFiltro(filtro);
  condicoes.push("categoria = 'colheita'", "unidade IS NOT NULL", "quantidade IS NOT NULL");

  const where = condicoes.join(" AND ");

  const totalPorUnidade = db
    .prepare(
      `SELECT unidade, SUM(quantidade) as quantidade FROM entries WHERE ${where} GROUP BY unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as QuantidadePorUnidade[];

  const porArea = db
    .prepare(
      `SELECT area, unidade, SUM(quantidade) as quantidade FROM entries WHERE ${where} GROUP BY area, unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as ProducaoPorArea[];

  const porLocal = db
    .prepare(
      `SELECT local, unidade, SUM(quantidade) as quantidade FROM entries WHERE ${where} AND local IS NOT NULL GROUP BY local, unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as QuantidadePorLocal[];

  const diasComColheita = (
    db.prepare(`SELECT COUNT(DISTINCT data) as dias FROM entries WHERE ${where}`).get(...params) as unknown as {
      dias: number;
    }
  ).dias;

  const melhorDia = db
    .prepare(
      `SELECT data, unidade, SUM(quantidade) as quantidade FROM entries WHERE ${where} GROUP BY data, unidade ORDER BY quantidade DESC LIMIT 1`,
    )
    .get(...params) as unknown as MelhorDiaColheita | undefined;

  return {
    totalPorUnidade,
    porArea,
    porLocal,
    diasComColheita,
    melhorDia: melhorDia ?? null,
  };
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

export function consultarVendas(filtro: { inicio: string; fim: string; area?: Area }): ResultadoVendas {
  const { condicoes, params } = condicoesFiltro(filtro);
  condicoes.push("categoria = 'venda'");
  const where = condicoes.join(" AND ");

  const porUnidade = db
    .prepare(
      `SELECT unidade, SUM(quantidade) as quantidade FROM entries
       WHERE ${where} AND unidade IS NOT NULL AND quantidade IS NOT NULL
       GROUP BY unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as QuantidadePorUnidade[];

  const porArea = db
    .prepare(
      `SELECT area, COALESCE(SUM(custo), 0) as total, COUNT(*) as registros FROM entries
       WHERE ${where} GROUP BY area ORDER BY total DESC`,
    )
    .all(...params) as unknown as VendaPorArea[];

  return {
    valorTotal: porArea.reduce((soma, a) => soma + a.total, 0),
    quantidadeRegistros: porArea.reduce((soma, a) => soma + a.registros, 0),
    porArea,
    porUnidade,
  };
}

export function consultarRegistros(filtro: FiltroPeriodo & { limite?: number }): Entry[] {
  const { condicoes, params } = condicoesFiltro(filtro);

  const limite = filtro.limite && filtro.limite > 0 ? Math.min(filtro.limite, 100) : 20;
  params.push(limite);

  const stmt = db.prepare(`
    SELECT * FROM entries
    WHERE ${condicoes.join(" AND ")}
    ORDER BY data DESC
    LIMIT ?
  `);
  return stmt.all(...params) as unknown as Entry[];
}

export interface UsoIA {
  provider: string;
  modelo: string;
  tokensInput: number;
  tokensOutput: number;
  // null quando os preços não estão configurados no .env — nunca estimamos
  // "no escuro".
  custoEstimado: number | null;
}

export function registrarUsoIA(uso: UsoIA): void {
  try {
    const stmt = db.prepare(`
      INSERT INTO ai_usage (provider, modelo, tokens_input, tokens_output, custo_estimado, criado_em)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(uso.provider, uso.modelo, uso.tokensInput, uso.tokensOutput, uso.custoEstimado, new Date().toISOString());
  } catch (err) {
    // Falha ao registrar métricas nunca deve derrubar uma resposta real.
    console.error("Erro ao registrar uso de IA:", err);
  }
}

export interface ResumoUsoIA {
  provider: string;
  chamadas: number;
  tokensInput: number;
  tokensOutput: number;
  custoEstimado: number | null;
}

export function consultarUsoIA(filtro: { inicio: string; fim: string }): ResumoUsoIA[] {
  const stmt = db.prepare(`
    SELECT
      provider,
      COUNT(*) as chamadas,
      SUM(tokens_input) as tokensInput,
      SUM(tokens_output) as tokensOutput,
      SUM(custo_estimado) as custoEstimado
    FROM ai_usage
    WHERE substr(criado_em, 1, 10) >= ? AND substr(criado_em, 1, 10) <= ?
    GROUP BY provider
    ORDER BY provider
  `);
  return stmt.all(filtro.inicio, filtro.fim) as unknown as ResumoUsoIA[];
}
