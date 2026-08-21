import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env");
}

// Cliente compartilhado entre todos os projetos (gestão rural, finanças
// pessoais, futuros) — cada um usa suas próprias tabelas, mas a conexão é uma
// só. Service role: este é um bot backend (nunca roda no navegador), então
// pode ignorar RLS com segurança — não expor essa chave em nenhum client-side.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function initDb(): Promise<void> {
  const { error } = await supabase.from("ai_usage").select("id").limit(1);
  if (error) {
    throw new Error(`Não foi possível conectar ao Supabase: ${error.message}`);
  }
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

export async function registrarUsoIA(uso: UsoIA): Promise<void> {
  try {
    const { error } = await supabase.from("ai_usage").insert({
      provider: uso.provider,
      modelo: uso.modelo,
      tokens_input: uso.tokensInput,
      tokens_output: uso.tokensOutput,
      custo_estimado: uso.custoEstimado,
    });
    if (error) throw error;
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

// Limite superior exclusivo (dia seguinte, 00:00 UTC) — criado_em é
// timestamptz, então comparamos contra o intervalo de datas inteiro em vez
// de recortar os 10 primeiros caracteres como fazia o `substr` no SQLite.
function proximoDiaISO(dataISO: string): string {
  const data = new Date(`${dataISO}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString();
}

export async function consultarUsoIA(filtro: { inicio: string; fim: string }): Promise<ResumoUsoIA[]> {
  const { data, error } = await supabase
    .from("ai_usage")
    .select("*")
    .gte("criado_em", `${filtro.inicio}T00:00:00.000Z`)
    .lt("criado_em", proximoDiaISO(filtro.fim));
  if (error) throw new Error(`Erro ao consultar uso de IA: ${error.message}`);

  const porProviderMap = new Map<string, ResumoUsoIA>();
  for (const row of data ?? []) {
    if (!porProviderMap.has(row.provider)) {
      porProviderMap.set(row.provider, { provider: row.provider, chamadas: 0, tokensInput: 0, tokensOutput: 0, custoEstimado: null });
    }
    const resumo = porProviderMap.get(row.provider)!;
    resumo.chamadas += 1;
    resumo.tokensInput += row.tokens_input as number;
    resumo.tokensOutput += row.tokens_output as number;
    if (row.custo_estimado !== null) {
      resumo.custoEstimado = (resumo.custoEstimado ?? 0) + Number(row.custo_estimado);
    }
  }

  return [...porProviderMap.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}
