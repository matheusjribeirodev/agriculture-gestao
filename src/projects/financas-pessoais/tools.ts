import { z } from "zod";
import {
  TIPOS,
  CATEGORIAS,
  CATEGORIAS_POR_TIPO,
  FORMAS_PAGAMENTO,
  consultarGastos,
  consultarReceitas,
  consultarPorFormaPagamento,
  consultarRegistros,
  type Tipo,
  type Categoria,
} from "./db";
import type { FerramentaDef } from "../../ai/types";
import type { ResultadoFerramenta } from "../types";

const DESCRICAO_TIPO_CATEGORIA = TIPOS.map(
  (tipo) => `${tipo}: ${CATEGORIAS_POR_TIPO[tipo].join(", ")}`,
).join(" | ");

export const FERRAMENTAS: FerramentaDef[] = [
  {
    nome: "registrar_lancamento",
    descricao:
      "Use quando a pessoa está relatando um gasto ou uma receita que já aconteceu (comprou, pagou, recebeu) — um novo lançamento pessoal para salvar. Não use para perguntas sobre lançamentos já existentes.",
    schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data do lançamento no formato YYYY-MM-DD. Se não mencionada, use a data de hoje." },
        tipo: {
          type: "string",
          enum: TIPOS,
          description: `"despesa" para dinheiro que saiu, "receita" para dinheiro que entrou. Categorias válidas por tipo: ${DESCRICAO_TIPO_CATEGORIA}.`,
        },
        categoria: { type: "string", enum: CATEGORIAS, description: "Deve ser uma categoria válida para o tipo escolhido." },
        valor: { type: "number", description: "Valor em reais." },
        descricao: { type: ["string", "null"], description: "Descrição curta do lançamento, ex: 'aluguel de agosto', 'mercado do mês'." },
        forma_pagamento: {
          type: ["string", "null"],
          enum: [...FORMAS_PAGAMENTO, null],
          description: "Como foi pago/recebido, se mencionado. Não invente se não foi dito.",
        },
      },
      required: ["data", "tipo", "categoria", "valor", "descricao", "forma_pagamento"],
    },
  },
  {
    nome: "consultar_gastos",
    descricao:
      "Consulta o total gasto (R$) e o detalhamento por categoria em um período. Use para perguntas sobre quanto foi gasto, com o quê.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS_POR_TIPO.despesa, description: "Opcional: filtrar por uma categoria de despesa específica." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_receitas",
    descricao:
      "Consulta o total recebido (R$) e o detalhamento por categoria em um período. Use para perguntas sobre quanto entrou/foi recebido.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS_POR_TIPO.receita, description: "Opcional: filtrar por uma categoria de receita específica." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_por_forma_pagamento",
    descricao:
      "Consulta quanto foi gasto por forma de pagamento (pix, dinheiro, cartão de crédito, cartão de débito) em um período. Use para perguntas tipo 'quanto gastei no cartão' ou 'quanto paguei no pix'.",
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
      "Lista lançamentos brutos em um período, opcionalmente filtrados por categoria e/ou tipo (despesa/receita). Use para perguntas abertas que as outras ferramentas não cobrem, como 'meus últimos lançamentos'.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS },
        tipo: { type: "string", enum: TIPOS },
        limite: { type: "number", description: "Número máximo de registros a retornar (padrão 20, máximo 100)." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "gerar_relatorio_pdf",
    descricao:
      "Gera e envia um PDF com o relatório de despesas e receitas do período pedido. Use sempre que a pessoa pedir o relatório em PDF, arquivo, documento para salvar/imprimir.",
    schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["mes_atual", "mes_passado"],
          description: "Período do relatório. Se não mencionado, use 'mes_atual'.",
        },
      },
      required: [],
    },
  },
];

const FiltroSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
  categoria: z.enum(CATEGORIAS as [Categoria, ...Categoria[]]).optional(),
});

const FiltroRegistrosSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
  categoria: z.enum(CATEGORIAS as [Categoria, ...Categoria[]]).optional(),
  tipo: z.enum(TIPOS as [Tipo, ...Tipo[]]).optional(),
  limite: z.number().optional(),
});

const FiltroFormaPagamentoSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
});

export async function executarFerramenta(nome: string, input: unknown): Promise<ResultadoFerramenta> {
  try {
    switch (nome) {
      case "consultar_gastos":
        return { ferramenta: nome, resultado: await consultarGastos(FiltroSchema.parse(input)) };
      case "consultar_receitas":
        return { ferramenta: nome, resultado: await consultarReceitas(FiltroSchema.parse(input)) };
      case "consultar_por_forma_pagamento":
        return { ferramenta: nome, resultado: await consultarPorFormaPagamento(FiltroFormaPagamentoSchema.parse(input)) };
      case "consultar_registros":
        return { ferramenta: nome, resultado: await consultarRegistros(FiltroRegistrosSchema.parse(input)) };
      default:
        return { ferramenta: nome, erro: `Ferramenta desconhecida: ${nome}` };
    }
  } catch (err) {
    return { ferramenta: nome, erro: err instanceof Error ? err.message : String(err) };
  }
}
