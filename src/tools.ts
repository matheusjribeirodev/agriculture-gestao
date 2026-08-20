import { z } from "zod";
import {
  CATEGORIAS,
  consultarGastos,
  consultarProducao,
  consultarVendas,
  consultarRegistros,
  type Categoria,
} from "./db";
import type { FerramentaDef } from "./ai/types";

const CATEGORIAS_SEM_VENDA = CATEGORIAS.filter((c) => c !== "venda") as [Categoria, ...Categoria[]];

export const FERRAMENTAS: FerramentaDef[] = [
  {
    nome: "registrar_entrada",
    descricao:
      "Use quando o produtor está relatando algo que aconteceu, foi feito, comprado ou vendido na propriedade — um novo registro para salvar. Não use para perguntas sobre dados já existentes.",
    schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data do evento no formato YYYY-MM-DD. Se não mencionada, use a data de hoje." },
        categoria: { type: "string", enum: CATEGORIAS },
        item: { type: ["string", "null"], description: "Nome do insumo, produto ou atividade." },
        quantidade: { type: ["number", "null"] },
        unidade: { type: ["string", "null"], description: 'Ex: "sacos", "kg", "litros", "diárias".' },
        custo: { type: ["number", "null"] },
        talhao: { type: ["string", "null"] },
        observacao: { type: ["string", "null"] },
      },
      required: ["data", "categoria", "item", "quantidade", "unidade", "custo", "talhao", "observacao"],
    },
  },
  {
    nome: "consultar_gastos",
    descricao:
      "Consulta o total gasto (R$) e o detalhamento por categoria em um período. Use para perguntas sobre quanto foi gasto, com o quê, ou em qual talhão. Não inclui vendas (isso é receita, não gasto).",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS_SEM_VENDA, description: "Opcional: filtrar por uma categoria de gasto específica." },
        talhao: { type: "string", description: "Opcional: filtrar por talhão." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_producao",
    descricao:
      "Consulta a produção colhida (por unidade) em um período, com detalhamento por talhão, dias com colheita e o melhor dia. Use para perguntas sobre quanto foi colhido/produzido, ou qual talhão produziu mais.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        talhao: { type: "string", description: "Opcional: filtrar por talhão." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_vendas",
    descricao:
      "Consulta o valor total vendido e as quantidades por unidade em um período. Use para perguntas sobre quanto foi vendido ou faturado.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_registros",
    descricao:
      "Lista registros brutos em um período, opcionalmente filtrados por categoria e/ou talhão. Use para perguntas abertas que as outras ferramentas não cobrem, como 'resumo da propriedade' ou 'meus últimos registros'.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS },
        talhao: { type: "string" },
        limite: { type: "number", description: "Número máximo de registros a retornar (padrão 20, máximo 100)." },
      },
      required: ["inicio", "fim"],
    },
  },
];

const FiltroSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
  categoria: z.enum(CATEGORIAS as [Categoria, ...Categoria[]]).optional(),
  talhao: z.string().optional(),
  limite: z.number().optional(),
});

export interface ResultadoFerramenta {
  ferramenta: string;
  resultado?: unknown;
  erro?: string;
}

export function executarFerramenta(nome: string, input: unknown): ResultadoFerramenta {
  try {
    switch (nome) {
      case "consultar_gastos":
        return { ferramenta: nome, resultado: consultarGastos(FiltroSchema.parse(input)) };
      case "consultar_producao":
        return { ferramenta: nome, resultado: consultarProducao(FiltroSchema.parse(input)) };
      case "consultar_vendas":
        return { ferramenta: nome, resultado: consultarVendas(FiltroSchema.parse(input)) };
      case "consultar_registros":
        return { ferramenta: nome, resultado: consultarRegistros(FiltroSchema.parse(input)) };
      default:
        return { ferramenta: nome, erro: `Ferramenta desconhecida: ${nome}` };
    }
  } catch (err) {
    return { ferramenta: nome, erro: err instanceof Error ? err.message : String(err) };
  }
}
