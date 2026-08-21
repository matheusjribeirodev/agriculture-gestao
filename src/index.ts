import "dotenv/config";
import {
  initDb,
  inserirEntry,
  listarRegistrosRecentes,
  excluirRegistroPorId,
  type EntradaParaSalvar,
  type Entry,
} from "./db";
import { interpretarMensagem, type EntradaExtraida, type TrocaAnterior } from "./parser";
import { conectarWhatsApp } from "./whatsapp";
import {
  gerarRelatorioMesAtual,
  gerarRelatorioMesPassado,
  gerarRelatorioUsoIAMesAtual,
  gerarRelatorioUsoIAMesPassado,
  formatarMoeda,
} from "./reports";
import { formatarDataBR } from "./format";
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

interface ExclusaoPendente {
  itens: Map<number, Entry>;
}

// Lista numerada de registros recentes aguardando escolha de qual excluir —
// também por número autorizado, e também perdida em restart (mesma lógica
// de `pendentes`).
const exclusoesPendentes = new Map<string, ExclusaoPendente>();

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

// Mesma lógica de tolerância a ruído de transcrição de áudio da regex
// positiva, só que pro lado negativo — descarta o registro pendente.
const REGEX_CONFIRMACAO_NEGATIVA =
  /^(nao|n|cancelar|cancela|esquece|esqueci|esquecer|deixa pra la|descarta|descartar|errado)\b/;

const REGEX_CONFIRMACAO_CORRIGIR = /^(corrigir|corrige|corrigi|correcao|correção)\b/;

function ehConfirmacaoPositiva(normalizado: string): boolean {
  return REGEX_CONFIRMACAO_POSITIVA.test(normalizado);
}

function ehConfirmacaoNegativa(normalizado: string): boolean {
  return REGEX_CONFIRMACAO_NEGATIVA.test(normalizado);
}

function ehPedidoCorrecao(normalizado: string): boolean {
  return REGEX_CONFIRMACAO_CORRIGIR.test(normalizado);
}

// Radical em vez de listar cada conjugação — cobre "apaga", "apagar",
// "apague", "apagando" etc. com uma entrada só.
const REGEX_VERBO_EXCLUSAO = /\b(apag\w*|exclu\w*|delet\w*|remov\w*)\b/;
const REGEX_ALVO_EXCLUSAO = /\b(registro|lancamento|entrada)\b/;

function ehPedidoExclusao(normalizado: string): boolean {
  return REGEX_VERBO_EXCLUSAO.test(normalizado) && REGEX_ALVO_EXCLUSAO.test(normalizado);
}

function formatarLinhaRegistro(entry: Entry): string {
  const partes = [formatarDataBR(entry.data), entry.area, entry.categoria];
  if (entry.item) partes.push(entry.item);
  if (entry.quantidade !== null) {
    partes.push(`${entry.quantidade}${entry.unidade ? " " + entry.unidade : ""}`);
  }
  if (entry.custo !== null) partes.push(formatarMoeda(entry.custo));
  return partes.join(" - ");
}

function formatarListaExclusao(entries: Entry[]): string {
  const linhas = ['🗑️ Qual registro deseja excluir? Responda com o número ou "cancelar".', ""];
  entries.forEach((entry, i) => {
    linhas.push(`${i + 1}. ${formatarLinhaRegistro(entry)}`);
  });
  return linhas.join("\n");
}

function formatarResumo(entrada: EntradaExtraida): string {
  const linhas = [
    "Entendi o seguinte:",
    "",
    `Data: ${formatarDataBR(entrada.data)}`,
    `Área: ${entrada.area}`,
    `Categoria: ${entrada.categoria}`,
  ];

  if (entrada.item) linhas.push(`Item: ${entrada.item}`);
  if (entrada.quantidade !== null) {
    linhas.push(`Quantidade: ${entrada.quantidade}${entrada.unidade ? " " + entrada.unidade : ""}`);
  }
  if (entrada.custo !== null) {
    const rotulo = entrada.categoria === "venda" ? "Receita" : "Custo";
    linhas.push(`${rotulo}: ${formatarMoeda(entrada.custo)}`);
  }
  if (entrada.local) linhas.push(`Local: ${entrada.local}`);
  if (entrada.observacao) linhas.push(`Observação: ${entrada.observacao}`);

  linhas.push("", 'Confirma? Responda "sim", "corrigir" ou "não".');
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
    const relatorio = await (normalizado.includes("passado")
      ? gerarRelatorioUsoIAMesPassado()
      : gerarRelatorioUsoIAMesAtual());
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

    const relatorio = await (querMesPassado ? gerarRelatorioMesPassado() : gerarRelatorioMesAtual());
    await responder(relatorio);
    return;
  }

  const exclusaoPendente = exclusoesPendentes.get(remetente);

  if (exclusaoPendente) {
    if (normalizado === "cancelar" || normalizado === "cancela") {
      exclusoesPendentes.delete(remetente);
      await responder("Ok, cancelado. Nenhum registro foi excluído.");
      return;
    }

    const numero = Number(normalizado);
    const escolhido = Number.isInteger(numero) ? exclusaoPendente.itens.get(numero) : undefined;

    if (escolhido) {
      exclusoesPendentes.delete(remetente);
      await excluirRegistroPorId(escolhido.id);
      await responder(`Excluído: ${formatarLinhaRegistro(escolhido)}`);
      return;
    }

    await responder('Não entendi. Responda com o número do registro que deseja excluir, ou "cancelar".');
    return;
  }

  if (ehPedidoExclusao(normalizado)) {
    const recentes = await listarRegistrosRecentes(10);
    if (recentes.length === 0) {
      await responder("Não há registros para excluir.");
      return;
    }
    const itens = new Map<number, Entry>();
    recentes.forEach((entry, i) => itens.set(i + 1, entry));
    exclusoesPendentes.set(remetente, { itens });
    await responder(formatarListaExclusao(recentes));
    return;
  }

  const pendente = pendentes.get(remetente);

  if (pendente) {
    if (ehConfirmacaoPositiva(normalizado)) {
      pendentes.delete(remetente);
      const entrada: EntradaParaSalvar = {
        ...pendente.extraida,
        mensagem_original: pendente.mensagemOriginal,
      };
      await inserirEntry(entrada);
      await responder("Registrado!");
      return;
    }

    if (ehConfirmacaoNegativa(normalizado)) {
      pendentes.delete(remetente);
      await responder("Ok, descartei esse registro. Nada foi salvo.");
      return;
    }

    if (ehPedidoCorrecao(normalizado)) {
      pendentes.delete(remetente);
      await responder("Sem problema, pode me mandar a informação correta.");
      return;
    }

    // Resposta não reconhecida: mantém a pendência ativa (não descarta) e
    // pede de novo, em vez de tratar como um novo registro por engano.
    await responder('Não entendi sua resposta. Responda "sim" para confirmar, "corrigir" para ajustar, ou "não" para descartar.');
    return;
  }

  const trocaAnterior = contextoPendente.get(remetente);
  contextoPendente.delete(remetente);

  const resultado = await interpretarMensagem(texto, trocaAnterior);

  if (resultado.tipo === "registrar") {
    pendentes.set(remetente, { extraida: resultado.dados, mensagemOriginal: texto });
    await responder(formatarResumo(resultado.dados));
    return;
  }

  if (resultado.tipo === "gerar_pdf") {
    await responder("📄 Gerando o PDF, só um instante...");
    const { buffer, nomeArquivo } =
      resultado.periodo === "mes_passado"
        ? await gerarPdfRelatorioMesPassado(resultado.area)
        : await gerarPdfRelatorioMesAtual(resultado.area);
    await enviarDocumento(remetente, buffer, nomeArquivo, "application/pdf");
    return;
  }

  if (!resultado.resolvida) {
    contextoPendente.set(remetente, { perguntaProdutor: texto, respostaBot: resultado.texto });
  }
  await responder(resultado.texto);
}

async function main(): Promise<void> {
  await initDb();

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
