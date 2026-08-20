import { z } from "zod";
import { CATEGORIAS, type Categoria } from "./db";
import { FERRAMENTAS, executarFerramenta } from "./tools";
import { AIRouter } from "./ai/router";
import { GeminiProvider } from "./ai/gemini-provider";
import { ClaudeProvider } from "./ai/claude-provider";
import type { TurnoConversa } from "./ai/types";

const EntradaSchema = z.object({
  data: z.string(),
  categoria: z.enum(CATEGORIAS as [Categoria, ...Categoria[]]),
  item: z.string().nullable(),
  quantidade: z.number().nullable(),
  unidade: z.string().nullable(),
  custo: z.number().nullable(),
  talhao: z.string().nullable(),
  observacao: z.string().nullable(),
});

export type EntradaExtraida = z.infer<typeof EntradaSchema>;

export interface TrocaAnterior {
  perguntaProdutor: string;
  respostaBot: string;
}

export type ResultadoInterpretacao =
  | { tipo: "registrar"; dados: EntradaExtraida }
  // `resolvida` diferencia uma resposta com dados reais (uma ferramenta foi
  // executada) de uma resposta conversacional/pergunta de esclarecimento
  // (nenhuma ferramenta foi chamada) — usado para decidir se vale a pena
  // lembrar essa troca para a próxima mensagem (ver TrocaAnterior).
  | { tipo: "resposta"; texto: string; resolvida: boolean };

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

const SYSTEM_PROMPT = `Você é um assistente de gestão para o produtor de uma propriedade cafeeira, conversando por WhatsApp. Data de hoje: ${hoje()}.

Você tem três funções:

1. REGISTRAR: quando o produtor relata algo que JÁ aconteceu, foi feito, comprado ou vendido (ex: "comprei 10 sacos de NPK", "colhi 200 sacas hoje"), use a ferramenta "registrar_entrada" para extrair os dados.
   - Categoria deve ser sempre uma de: ${CATEGORIAS.join(", ")}. Se não encaixar em nenhuma, use "outro".
   - Se um campo não puder ser identificado, use null (nunca invente valores — isso vale para qualquer campo, não só números: não invente talhão, observação, destino, nome de pessoa ou qualquer outro detalhe que não tenha sido dito explicitamente).
   - Datas relativas ("ontem", "semana passada") devem virar YYYY-MM-DD com base em hoje.
   - Uma promessa ou intenção futura (ex: "vou entregar segunda-feira", "pretendo colher semana que vem") NÃO é um registro — ainda não aconteceu. Responda em texto confirmando o entendimento e avise que vai aguardar a confirmação de que a ação realmente ocorreu; não chame "registrar_entrada" nesse caso.
   - Se a mensagem anterior sua ficou de aguardar confirmação de uma ação futura, uma resposta curta e vaga do produtor depois (ex: "pode deixar", "ok", "combinado", "beleza") NÃO confirma sozinha que a ação foi concluída — só trate como concluída se o produtor disser isso explicitamente (ex: "entreguei", "já fiz", "confirmado, entreguei hoje"). Na dúvida, pergunte se já aconteceu antes de registrar.

2. CONSULTAR: quando o produtor pergunta sobre dados já registrados (gastos, produção, vendas, talhões), use uma das ferramentas "consultar_*" com o período correto — resolva expressões como "mês passado", "este ano", "últimos 30 dias" em datas YYYY-MM-DD com base em hoje. Você pode chamar mais de uma ferramenta na mesma resposta quando precisar combinar dados (ex: para calcular custo por saca, chame consultar_gastos e consultar_producao para o mesmo período e divida você mesmo, deixando claro que o cálculo considera só o que está registrado), e pode fazer isso em mais de uma rodada se precisar aprofundar (ex: olhar o resumo primeiro e depois pedir o detalhamento de registros). Mas assim que tiver dados suficientes para responder, RESPONDA EM TEXTO — não fique encadeando consultas indefinidamente.

3. PREÇO DE MERCADO: quando o produtor perguntar sobre o preço/cotação do café no mercado (não é dado da propriedade, é preço de mercado externo), use "consultar_preco_cafe". Informe a data de fechamento retornada e cite pelo menos algumas praças/cooperativas com preço disponível; se algum município aparecer "s/ cotação", não invente um valor pra ele.

Regras importantes:
- NUNCA invente números. Toda informação sobre a propriedade OU sobre preço de mercado deve vir do resultado de uma ferramenta. Se o resultado não tiver dados suficientes, diga isso claramente em vez de estimar.
- Não existe controle de estoque no sistema ainda — se perguntarem quanto ainda resta/tem em estoque, explique essa limitação em vez de calcular uma estimativa.
- Se faltar uma informação necessária para consultar (por exemplo, o período), NÃO chame nenhuma ferramenta — pergunte ao produtor primeiro, de forma curta.
- Se a mensagem não for nem um registro nem uma pergunta sobre dados (cumprimento, conversa), responda direto em texto, sem usar ferramenta.
- Respostas curtas, diretas, fáceis de ler no WhatsApp, com emojis usados com moderação. Formate valores em reais e unidades claramente. Não mencione termos técnicos internos (banco de dados, SQL, categoria, ferramenta, etc.).`;

function criarRouter(): AIRouter {
  const geminiKey = process.env.GEMINI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey) throw new Error("Defina GEMINI_API_KEY no arquivo .env");
  if (!claudeKey) throw new Error("Defina ANTHROPIC_API_KEY no arquivo .env");

  const gemini = new GeminiProvider(geminiKey, process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
  const claude = new ClaudeProvider(claudeKey, process.env.CLAUDE_MODEL || "claude-opus-5");
  return new AIRouter(gemini, claude);
}

const router = criarRouter();

export async function interpretarMensagem(
  texto: string,
  trocaAnterior?: TrocaAnterior,
): Promise<ResultadoInterpretacao> {
  const historico: TurnoConversa[] = trocaAnterior
    ? [
        { autor: "produtor", texto: trocaAnterior.perguntaProdutor },
        { autor: "bot", texto: trocaAnterior.respostaBot },
      ]
    : [];

  const resultado = await router.interpretar(
    { systemPrompt: SYSTEM_PROMPT, historico, mensagem: texto, ferramentas: FERRAMENTAS },
    executarFerramenta,
  );

  if (resultado.tipo === "registrar") {
    return { tipo: "registrar", dados: EntradaSchema.parse(resultado.chamada.input) };
  }

  return {
    tipo: "resposta",
    texto: resultado.texto || "Não consegui gerar uma resposta.",
    resolvida: resultado.teveFerramentas,
  };
}
