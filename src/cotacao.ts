import * as cheerio from "cheerio";

const URL_COTACAO_CAFE =
  "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-duro";

export interface CotacaoMunicipio {
  municipio: string;
  // Mantemos o preço/variação como texto (ex: "1.878,00", "s/ cotação"),
  // igual aparece no site — evita risco de erro de conversão numérica em
  // cima de formatação que pode variar (milhar com ponto, decimal com
  // vírgula, "s/ cotação" quando não há preço do dia).
  precoTexto: string;
  variacaoTexto: string;
}

export interface CotacaoCafe {
  produto: string;
  fonte: string;
  dataFechamento: string;
  cotacoes: CotacaoMunicipio[];
}

// Cache curto — evita buscar a página de novo a cada pergunta seguida (o
// preço só fecha uma vez por dia útil de qualquer forma).
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { dados: CotacaoCafe; buscadoEm: number } | null = null;

async function buscarCotacaoCafeSemCache(): Promise<CotacaoCafe> {
  const resposta = await fetch(URL_COTACAO_CAFE, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; bot-gestao-rural/1.0)" },
  });
  if (!resposta.ok) {
    throw new Error(`Falha ao buscar cotação (status ${resposta.status})`);
  }

  const html = await resposta.text();
  const $ = cheerio.load(html);

  // A página lista o fechamento mais recente primeiro, seguido do
  // histórico de dias anteriores — pegamos só o primeiro bloco.
  const primeiroBloco = $(".tables .cotacao").first();
  const dataFechamento = primeiroBloco.find(".fechamento").text().replace("Fechamento:", "").trim();

  const cotacoes: CotacaoMunicipio[] = [];
  primeiroBloco.find("table.cot-fisicas tbody tr").each((_, linha) => {
    const celulas = $(linha).find("td");
    const municipio = $(celulas[0]).text().trim();
    const precoTexto = $(celulas[1]).text().trim();
    const variacaoTexto = $(celulas[2]).text().trim();
    if (municipio) {
      cotacoes.push({ municipio, precoTexto, variacaoTexto });
    }
  });

  if (cotacoes.length === 0) {
    throw new Error("Não encontrei a tabela de cotações na página (a estrutura do site pode ter mudado).");
  }

  return {
    produto: "Café Arábica - Mercado Físico (Tipo 6/7, Bebida Dura, Bica Corrida)",
    fonte: "Notícias Agrícolas",
    dataFechamento,
    cotacoes,
  };
}

export async function buscarCotacaoCafe(): Promise<CotacaoCafe> {
  if (cache && Date.now() - cache.buscadoEm < CACHE_TTL_MS) {
    return cache.dados;
  }
  const dados = await buscarCotacaoCafeSemCache();
  cache = { dados, buscadoEm: Date.now() };
  return dados;
}
