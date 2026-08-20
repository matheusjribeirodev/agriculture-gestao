import "dotenv/config";
import { initDb, inserirEntry, type EntradaParaSalvar } from "./db";
import { interpretarMensagem, type EntradaExtraida, type TrocaAnterior } from "./parser";
import { conectarWhatsApp } from "./whatsapp";
import {
  gerarRelatorioMesAtual,
  gerarRelatorioMesPassado,
  gerarRelatorioUsoIAMesAtual,
  gerarRelatorioUsoIAMesPassado,
  formatarMoeda,
} from "./reports";

const numeroAutorizado = process.env.WHATSAPP_NUMBER_AUTORIZADO;
if (!numeroAutorizado) {
  throw new Error("Defina WHATSAPP_NUMBER_AUTORIZADO no arquivo .env");
}

interface ConfirmacaoPendente {
  extraida: EntradaExtraida;
  mensagemOriginal: string;
}

// Um único produtor autorizado no MVP, mas mantido como Map por simplicidade
// de extensão futura (ver README/escopo do projeto).
const pendentes = new Map<string, ConfirmacaoPendente>();

// Guarda a última pergunta de esclarecimento do bot (quando ele não teve
// dados suficientes pra consultar nada) para dar contexto na próxima
// mensagem — ver TrocaAnterior em parser.ts.
const contextoPendente = new Map<string, TrocaAnterior>();

const REGEX_DIACRITICOS = /[̀-ͯ]/g;
const REGEX_PONTUACAO_BORDA = /^[.,!?;:\s]+|[.,!?;:\s]+$/g;

function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(REGEX_DIACRITICOS, "")
    .toLowerCase()
    .trim()
    .replace(REGEX_PONTUACAO_BORDA, "");
}

// Confirmação por áudio chega transcrita, então pode vir com palavras a
// mais ou pontuação diferente do que alguém digitaria (ex: "Sim.", "sim,
// pode confirmar", "s"). Em vez de exigir igualdade exata, aceita quando a
// mensagem COMEÇA com uma dessas expressões — cobre tanto a resposta curta
// digitada quanto a falada.
const REGEX_CONFIRMACAO_POSITIVA =
  /^(sim|s|confirmo|confirmar|confirma|correto|isso mesmo|isso|ok|pode confirmar|pode|positivo|exato|certo)\b/;

function ehConfirmacaoPositiva(normalizado: string): boolean {
  return REGEX_CONFIRMACAO_POSITIVA.test(normalizado);
}

function formatarResumo(entrada: EntradaExtraida): string {
  const linhas = ["Entendi o seguinte:", "", `Data: ${entrada.data}`, `Categoria: ${entrada.categoria}`];

  if (entrada.item) linhas.push(`Item: ${entrada.item}`);
  if (entrada.quantidade !== null) {
    linhas.push(`Quantidade: ${entrada.quantidade}${entrada.unidade ? " " + entrada.unidade : ""}`);
  }
  if (entrada.custo !== null) linhas.push(`Custo: ${formatarMoeda(entrada.custo)}`);
  if (entrada.talhao) linhas.push(`Talhão: ${entrada.talhao}`);
  if (entrada.observacao) linhas.push(`Observação: ${entrada.observacao}`);

  linhas.push("", 'Confirma? Responda "sim" ou "corrigir".');
  return linhas.join("\n");
}

async function processarMensagem(
  texto: string,
  enviarMensagem: (texto: string) => Promise<void>,
): Promise<void> {
  const normalizado = normalizarTexto(texto);

  if (normalizado.includes("uso de ia") || normalizado.includes("uso da ia") || normalizado.includes("consumo de ia")) {
    const relatorio = normalizado.includes("passado")
      ? gerarRelatorioUsoIAMesPassado()
      : gerarRelatorioUsoIAMesAtual();
    await enviarMensagem(relatorio);
    return;
  }

  if (normalizado.includes("relatorio")) {
    const relatorio = normalizado.includes("passado")
      ? gerarRelatorioMesPassado()
      : gerarRelatorioMesAtual();
    await enviarMensagem(relatorio);
    return;
  }

  const pendente = pendentes.get(numeroAutorizado!);

  if (pendente) {
    pendentes.delete(numeroAutorizado!);

    if (ehConfirmacaoPositiva(normalizado)) {
      const entrada: EntradaParaSalvar = {
        ...pendente.extraida,
        mensagem_original: pendente.mensagemOriginal,
      };
      inserirEntry(entrada);
      await enviarMensagem("Registrado!");
      return;
    }

    // "corrigir" ou qualquer outra coisa: descarta o pendente e cai para
    // o fluxo abaixo, tratando esta mensagem como um novo registro.
  }

  const trocaAnterior = contextoPendente.get(numeroAutorizado!);
  contextoPendente.delete(numeroAutorizado!);

  const resultado = await interpretarMensagem(texto, trocaAnterior);

  if (resultado.tipo === "registrar") {
    pendentes.set(numeroAutorizado!, { extraida: resultado.dados, mensagemOriginal: texto });
    await enviarMensagem(formatarResumo(resultado.dados));
    return;
  }

  if (!resultado.resolvida) {
    contextoPendente.set(numeroAutorizado!, { perguntaProdutor: texto, respostaBot: resultado.texto });
  }
  await enviarMensagem(resultado.texto);
}

async function main(): Promise<void> {
  initDb();

  const { enviarMensagem } = await conectarWhatsApp(numeroAutorizado!, async (texto) => {
    try {
      await processarMensagem(texto, enviarMensagem);
    } catch (err) {
      console.error("Erro ao processar mensagem:", err);
      await enviarMensagem("Ocorreu um erro ao processar sua mensagem. Tente novamente.");
    }
  });

  console.log(`Bot pronto. Aguardando mensagens de ${numeroAutorizado}...`);
}

main().catch((err) => {
  console.error("Erro fatal ao iniciar o bot:", err);
  process.exit(1);
});
