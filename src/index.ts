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
import { gerarPdfRelatorioMesAtual, gerarPdfRelatorioMesPassado } from "./pdf";

// Aceita uma lista separada por vírgula (WHATSAPP_NUMEROS_AUTORIZADOS) ou,
// por compatibilidade, a variável antiga de um único número.
function lerNumerosAutorizados(): string[] {
  const lista = process.env.WHATSAPP_NUMEROS_AUTORIZADOS;
  if (lista) {
    return lista
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
  }
  const unico = process.env.WHATSAPP_NUMBER_AUTORIZADO;
  return unico ? [unico] : [];
}

const numerosAutorizados = lerNumerosAutorizados();
if (numerosAutorizados.length === 0) {
  throw new Error("Defina WHATSAPP_NUMEROS_AUTORIZADOS (ou WHATSAPP_NUMBER_AUTORIZADO) no arquivo .env");
}

interface ConfirmacaoPendente {
  extraida: EntradaExtraida;
  mensagemOriginal: string;
}

// Uma entrada por número autorizado — cada produtor tem sua própria
// confirmação pendente e memória de acompanhamento, sem interferir uma na
// outra.
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
  remetente: string,
  enviarMensagem: (remetente: string, texto: string) => Promise<void>,
  enviarDocumento: (remetente: string, buffer: Buffer, nomeArquivo: string, mimetype: string) => Promise<void>,
): Promise<void> {
  const normalizado = normalizarTexto(texto);
  const responder = (resposta: string) => enviarMensagem(remetente, resposta);

  if (normalizado.includes("uso de ia") || normalizado.includes("uso da ia") || normalizado.includes("consumo de ia")) {
    const relatorio = normalizado.includes("passado")
      ? gerarRelatorioUsoIAMesPassado()
      : gerarRelatorioUsoIAMesAtual();
    await responder(relatorio);
    return;
  }

  if (normalizado.includes("relatorio")) {
    const querPdf = normalizado.includes("pdf");
    const querMesPassado = normalizado.includes("passado");

    if (querPdf) {
      await responder("📄 Gerando o PDF, só um instante...");
      const { buffer, nomeArquivo } = querMesPassado
        ? await gerarPdfRelatorioMesPassado()
        : await gerarPdfRelatorioMesAtual();
      await enviarDocumento(remetente, buffer, nomeArquivo, "application/pdf");
      return;
    }

    const relatorio = querMesPassado ? gerarRelatorioMesPassado() : gerarRelatorioMesAtual();
    await responder(relatorio);
    return;
  }

  const pendente = pendentes.get(remetente);

  if (pendente) {
    pendentes.delete(remetente);

    if (ehConfirmacaoPositiva(normalizado)) {
      const entrada: EntradaParaSalvar = {
        ...pendente.extraida,
        mensagem_original: pendente.mensagemOriginal,
      };
      inserirEntry(entrada);
      await responder("Registrado!");
      return;
    }

    // "corrigir" ou qualquer outra coisa: descarta o pendente e cai para
    // o fluxo abaixo, tratando esta mensagem como um novo registro.
  }

  const trocaAnterior = contextoPendente.get(remetente);
  contextoPendente.delete(remetente);

  const resultado = await interpretarMensagem(texto, trocaAnterior);

  if (resultado.tipo === "registrar") {
    pendentes.set(remetente, { extraida: resultado.dados, mensagemOriginal: texto });
    await responder(formatarResumo(resultado.dados));
    return;
  }

  if (!resultado.resolvida) {
    contextoPendente.set(remetente, { perguntaProdutor: texto, respostaBot: resultado.texto });
  }
  await responder(resultado.texto);
}

async function main(): Promise<void> {
  initDb();

  const { enviarMensagem, enviarDocumento } = await conectarWhatsApp(numerosAutorizados, async (texto, remetente) => {
    try {
      await processarMensagem(texto, remetente, enviarMensagem, enviarDocumento);
    } catch (err) {
      console.error("Erro ao processar mensagem:", err);
      await enviarMensagem(remetente, "Ocorreu um erro ao processar sua mensagem. Tente novamente.");
    }
  });

  console.log(`Bot pronto. Aguardando mensagens de: ${numerosAutorizados.join(", ")}`);
}

main().catch((err) => {
  console.error("Erro fatal ao iniciar o bot:", err);
  process.exit(1);
});
