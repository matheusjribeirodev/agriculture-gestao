import { z } from "zod";
import {
  CATEGORIAS,
  AREAS,
  CATEGORIAS_POR_AREA,
  consultarGastos,
  consultarProducao,
  consultarVendas,
  consultarRegistros,
  type Categoria,
  type Area,
} from "./db";
import { buscarCotacaoCafe } from "./cotacao";
import type { FerramentaDef } from "../../ai/types";
import type { ResultadoFerramenta } from "../types";

const CATEGORIAS_SEM_VENDA = CATEGORIAS.filter((c) => c !== "venda") as [Categoria, ...Categoria[]];

const DESCRICAO_AREA_CATEGORIA = AREAS.map(
  (area) => `${area}: ${CATEGORIAS_POR_AREA[area].join(", ")}`,
).join(" | ");

export const FERRAMENTAS: FerramentaDef[] = [
  {
    nome: "registrar_entrada",
    descricao:
      "Use quando o produtor está relatando algo que aconteceu, foi feito, comprado ou vendido na propriedade — um novo registro para salvar. Não use para perguntas sobre dados já existentes.",
    schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data do evento no formato YYYY-MM-DD. Se não mencionada, use a data de hoje." },
        area: {
          type: "string",
          enum: AREAS,
          description: `Área da propriedade a que o registro pertence. "cafe" para atividades da lavoura de café, "propriedade" para manutenção/infraestrutura geral (trator, cerca, energia, água), "outro" para o que não encaixa nas duas. Categorias válidas por área: ${DESCRICAO_AREA_CATEGORIA}.`,
        },
        categoria: { type: "string", enum: CATEGORIAS, description: "Deve ser uma categoria válida para a área escolhida." },
        item: { type: ["string", "null"], description: "Nome do insumo, produto ou atividade." },
        quantidade: { type: ["number", "null"] },
        unidade: { type: ["string", "null"], description: 'Ex: "sacos", "kg", "litros", "diárias".' },
        custo: { type: ["number", "null"], description: "Valor em reais. Para categoria 'venda', é o valor recebido (receita), não uma despesa." },
        local: {
          type: ["string", "null"],
          description:
            'Local dentro da propriedade (ex: "Talhão 3", "Curral", "Galpão", "Represa") OU, para categoria "venda", o destino/comprador quando mencionado (ex: "Cido Baubau", "Cooperativa X") — o nome de pra quem ou pra onde foi vendido.',
        },
        observacao: { type: ["string", "null"] },
      },
      required: ["data", "area", "categoria", "item", "quantidade", "unidade", "custo", "local", "observacao"],
    },
  },
  {
    nome: "consultar_gastos",
    descricao:
      "Consulta o total gasto (R$) e o detalhamento por categoria em um período. Use para perguntas sobre quanto foi gasto, com o quê, ou em qual local. Não inclui vendas (isso é receita, não gasto). Sempre retorna o detalhamento por área — se o produtor não pediu uma área específica, informe o total geral E a divisão por área, nunca um número só misturando tudo.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS_SEM_VENDA, description: "Opcional: filtrar por uma categoria de gasto específica." },
        local: { type: "string", description: "Opcional: filtrar por local/talhão." },
        area: { type: "string", enum: AREAS, description: "Opcional: filtrar por área (cafe, propriedade ou outro)." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_producao",
    descricao:
      "Consulta a produção colhida (por unidade) em um período, com detalhamento por área, por local e o melhor dia. Use para perguntas sobre quanto foi colhido/produzido, ou qual local produziu mais.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        local: { type: "string", description: "Opcional: filtrar por local/talhão." },
        area: { type: "string", enum: AREAS, description: "Opcional: filtrar por área (cafe, propriedade ou outro)." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_vendas",
    descricao:
      "Consulta o valor total vendido e as quantidades por unidade em um período. Use para perguntas sobre quanto foi vendido ou faturado. Sempre retorna o detalhamento por área.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        area: { type: "string", enum: AREAS, description: "Opcional: filtrar por área (cafe, propriedade ou outro)." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_registros",
    descricao:
      "Lista registros brutos em um período, opcionalmente filtrados por categoria, local e/ou área. Use para perguntas abertas que as outras ferramentas não cobrem, como 'resumo da propriedade' ou 'meus últimos registros'.",
    schema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "Data inicial do período, YYYY-MM-DD." },
        fim: { type: "string", description: "Data final do período, YYYY-MM-DD." },
        categoria: { type: "string", enum: CATEGORIAS },
        local: { type: "string" },
        area: { type: "string", enum: AREAS },
        limite: { type: "number", description: "Número máximo de registros a retornar (padrão 20, máximo 100)." },
      },
      required: ["inicio", "fim"],
    },
  },
  {
    nome: "consultar_preco_cafe",
    descricao:
      "Consulta a cotação atual do café arábica (tipo 6/7, bebida dura, bica corrida) no mercado físico, por município/cooperativa, direto da fonte (Notícias Agrícolas). Use quando o produtor perguntar sobre o preço/cotação do café no mercado — isso NÃO é dado da propriedade, é preço de mercado externo.",
    schema: {
      type: "object",
      properties: {},
    },
  },
  {
    nome: "gerar_relatorio_pdf",
    descricao:
      "Gera e envia um PDF com o relatório de gastos, receitas e produção do período pedido. Use sempre que o produtor pedir o relatório em PDF, arquivo, documento para salvar/imprimir — de qualquer jeito que ele formular o pedido (não só a frase exata 'relatório em pdf').",
    schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["mes_atual", "mes_passado"],
          description: "Período do relatório. Se não mencionado, use 'mes_atual'.",
        },
        area: { type: "string", enum: AREAS, description: "Opcional: gerar o PDF só de uma área específica. Se não pedido, inclui todas." },
      },
      required: [],
    },
  },
];

const FiltroSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
  categoria: z.enum(CATEGORIAS as [Categoria, ...Categoria[]]).optional(),
  local: z.string().optional(),
  area: z.enum(AREAS as [Area, ...Area[]]).optional(),
  limite: z.number().optional(),
});

const FiltroVendasSchema = z.object({
  inicio: z.string(),
  fim: z.string(),
  area: z.enum(AREAS as [Area, ...Area[]]).optional(),
});

export async function executarFerramenta(nome: string, input: unknown): Promise<ResultadoFerramenta> {
  try {
    switch (nome) {
      case "consultar_gastos":
        return { ferramenta: nome, resultado: await consultarGastos(FiltroSchema.parse(input)) };
      case "consultar_producao":
        return { ferramenta: nome, resultado: await consultarProducao(FiltroSchema.parse(input)) };
      case "consultar_vendas":
        return { ferramenta: nome, resultado: await consultarVendas(FiltroVendasSchema.parse(input)) };
      case "consultar_registros":
        return { ferramenta: nome, resultado: await consultarRegistros(FiltroSchema.parse(input)) };
      case "consultar_preco_cafe":
        return { ferramenta: nome, resultado: await buscarCotacaoCafe() };
      default:
        return { ferramenta: nome, erro: `Ferramenta desconhecida: ${nome}` };
    }
  } catch (err) {
    return { ferramenta: nome, erro: err instanceof Error ? err.message : String(err) };
  }
}
