import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export type Categoria =
  | "adubacao"
  | "colheita"
  | "poda"
  | "defensivo"
  | "mao_de_obra"
  | "venda"
  | "outro";

export const CATEGORIAS: Categoria[] = [
  "adubacao",
  "colheita",
  "poda",
  "defensivo",
  "mao_de_obra",
  "venda",
  "outro",
];

export interface EntradaParaSalvar {
  data: string;
  categoria: Categoria;
  item: string | null;
  quantidade: number | null;
  unidade: string | null;
  custo: number | null;
  talhao: string | null;
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

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      categoria TEXT NOT NULL,
      item TEXT,
      quantidade REAL,
      unidade TEXT,
      custo REAL,
      talhao TEXT,
      observacao TEXT,
      mensagem_original TEXT NOT NULL,
      criado_em TEXT NOT NULL
    )
  `);

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
      (data, categoria, item, quantidade, unidade, custo, talhao, observacao, mensagem_original, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const criadoEm = new Date().toISOString();
  const resultado = stmt.run(
    entrada.data,
    entrada.categoria,
    entrada.item,
    entrada.quantidade,
    entrada.unidade,
    entrada.custo,
    entrada.talhao,
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
  talhao?: string;
}

export interface GastoPorCategoria {
  categoria: Categoria;
  total: number;
  registros: number;
}

export interface ResultadoGastos {
  totalGasto: number;
  quantidadeRegistros: number;
  porCategoria: GastoPorCategoria[];
}

export function consultarGastos(filtro: FiltroPeriodo): ResultadoGastos {
  const condicoes = ["data >= ?", "data <= ?", "categoria != 'venda'"];
  const params: SQLInputValue[] = [filtro.inicio, filtro.fim];

  if (filtro.categoria) {
    condicoes.push("categoria = ?");
    params.push(filtro.categoria);
  }
  if (filtro.talhao) {
    condicoes.push("talhao = ?");
    params.push(filtro.talhao);
  }

  const stmt = db.prepare(`
    SELECT categoria, COALESCE(SUM(custo), 0) as total, COUNT(*) as registros
    FROM entries
    WHERE ${condicoes.join(" AND ")}
    GROUP BY categoria
    ORDER BY total DESC
  `);
  const linhas = stmt.all(...params) as unknown as { categoria: Categoria; total: number; registros: number }[];

  const porCategoria = linhas.map((linha) => ({
    categoria: linha.categoria,
    total: linha.total,
    registros: linha.registros,
  }));

  return {
    totalGasto: porCategoria.reduce((soma, c) => soma + c.total, 0),
    quantidadeRegistros: porCategoria.reduce((soma, c) => soma + c.registros, 0),
    porCategoria,
  };
}

export interface QuantidadePorUnidade {
  unidade: string;
  quantidade: number;
}

export interface QuantidadePorTalhao {
  talhao: string;
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
  porTalhao: QuantidadePorTalhao[];
  diasComColheita: number;
  melhorDia: MelhorDiaColheita | null;
}

export function consultarProducao(filtro: Omit<FiltroPeriodo, "categoria">): ResultadoProducao {
  const condicoes = ["data >= ?", "data <= ?", "categoria = 'colheita'", "unidade IS NOT NULL", "quantidade IS NOT NULL"];
  const params: SQLInputValue[] = [filtro.inicio, filtro.fim];

  if (filtro.talhao) {
    condicoes.push("talhao = ?");
    params.push(filtro.talhao);
  }

  const where = condicoes.join(" AND ");

  const totalPorUnidade = db
    .prepare(
      `SELECT unidade, SUM(quantidade) as quantidade FROM entries WHERE ${where} GROUP BY unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as QuantidadePorUnidade[];

  const porTalhao = db
    .prepare(
      `SELECT talhao, unidade, SUM(quantidade) as quantidade FROM entries WHERE ${where} AND talhao IS NOT NULL GROUP BY talhao, unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as QuantidadePorTalhao[];

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
    porTalhao,
    diasComColheita,
    melhorDia: melhorDia ?? null,
  };
}

export interface ResultadoVendas {
  valorTotal: number;
  quantidadeRegistros: number;
  porUnidade: QuantidadePorUnidade[];
}

export function consultarVendas(filtro: Omit<FiltroPeriodo, "categoria" | "talhao">): ResultadoVendas {
  const params: SQLInputValue[] = [filtro.inicio, filtro.fim];

  const porUnidade = db
    .prepare(
      `SELECT unidade, SUM(quantidade) as quantidade FROM entries
       WHERE data >= ? AND data <= ? AND categoria = 'venda' AND unidade IS NOT NULL AND quantidade IS NOT NULL
       GROUP BY unidade ORDER BY quantidade DESC`,
    )
    .all(...params) as unknown as QuantidadePorUnidade[];

  const totais = db
    .prepare(
      `SELECT COALESCE(SUM(custo), 0) as valorTotal, COUNT(*) as registros FROM entries
       WHERE data >= ? AND data <= ? AND categoria = 'venda'`,
    )
    .get(...params) as unknown as { valorTotal: number; registros: number };

  return {
    valorTotal: totais.valorTotal,
    quantidadeRegistros: totais.registros,
    porUnidade,
  };
}

export function consultarRegistros(filtro: FiltroPeriodo & { limite?: number }): Entry[] {
  const condicoes = ["data >= ?", "data <= ?"];
  const params: SQLInputValue[] = [filtro.inicio, filtro.fim];

  if (filtro.categoria) {
    condicoes.push("categoria = ?");
    params.push(filtro.categoria);
  }
  if (filtro.talhao) {
    condicoes.push("talhao = ?");
    params.push(filtro.talhao);
  }

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
