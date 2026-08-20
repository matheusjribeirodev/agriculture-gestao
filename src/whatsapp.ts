import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import path from "node:path";
import { transcreverAudio, duracaoValida, DURACAO_MAXIMA_SEGUNDOS } from "./audio";

const AUTH_DIR = path.join(__dirname, "..", "auth_info");
const logger = pino({ level: "silent" });

// `remetente` é o número autorizado (do jeito que está no .env) que enviou a
// mensagem — usado como identidade estável em memória (confirmações
// pendentes, histórico de acompanhamento), independente de qual JID o
// WhatsApp usou pra representar essa conversa.
export type MensagemHandler = (texto: string, remetente: string) => Promise<void>;

export interface WhatsAppConexao {
  enviarMensagem: (remetente: string, texto: string) => Promise<void>;
  enviarDocumento: (remetente: string, buffer: Buffer, nomeArquivo: string, mimetype: string) => Promise<void>;
}

export async function conectarWhatsApp(
  numerosAutorizados: string[],
  onMensagem: MensagemHandler,
): Promise<WhatsAppConexao> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  let sock: WASocket = iniciarSocket();

  // IDs de mensagens enviadas pelo próprio bot, para não reprocessá-las
  // como se fossem mensagens novas.
  const mensagensDoBot = new Set<string>();

  // JID da conversa da última mensagem válida recebida de cada número
  // autorizado — respondemos sempre nesse mesmo JID, em vez de reconstruir
  // um a partir do número. Isso evita problemas com o "nono dígito" de
  // números brasileiros e com contas onde o WhatsApp usa LID em vez do
  // número de telefone.
  const jidsParaResponder = new Map<string, string>();

  // LID de cada número autorizado, resolvido via sock.onWhatsApp() assim
  // que a conexão abre. Quando as duas contas ainda não "se conhecem" o
  // suficiente, o WhatsApp identifica o remetente pelo LID em vez do
  // número de telefone — sem isso, não teríamos como saber quem é.
  const lidsPorNumero = new Map<string, string>();

  async function enviarParaJid(jid: string, texto: string): Promise<void> {
    const enviada = await sock.sendMessage(jid, { text: texto });
    if (enviada?.key.id) {
      mensagensDoBot.add(enviada.key.id);
    }
  }

  async function enviarDocumentoParaJid(
    jid: string,
    buffer: Buffer,
    nomeArquivo: string,
    mimetype: string,
  ): Promise<void> {
    const enviada = await sock.sendMessage(jid, { document: buffer, fileName: nomeArquivo, mimetype });
    if (enviada?.key.id) {
      mensagensDoBot.add(enviada.key.id);
    }
  }

  function iniciarSocket(): WASocket {
    const socket = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\nEscaneie o QR code abaixo com o WhatsApp:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("Conectado ao WhatsApp.");
        for (const numero of numerosAutorizados) {
          socket
            .onWhatsApp(`${numero}@s.whatsapp.net`)
            .then((resultados) => {
              const lid = resultados?.[0]?.lid;
              if (typeof lid === "string") {
                lidsPorNumero.set(numero, lid.split("@")[0].split(":")[0]);
              }
            })
            .catch((err) => console.error(`Erro ao resolver LID de ${numero}:`, err));
        }
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const deveReconectar = statusCode !== DisconnectReason.loggedOut;
        console.log(
          `Conexão encerrada (status ${statusCode ?? "desconhecido"}).`,
          deveReconectar ? "Reconectando..." : "Sessão deslogada, apague auth_info/ e reinicie.",
        );
        if (deveReconectar) {
          sock = iniciarSocket();
        }
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        await tratarMensagem(
          socket,
          msg,
          numerosAutorizados,
          lidsPorNumero,
          mensagensDoBot,
          enviarParaJid,
          (numero, jid) => {
            jidsParaResponder.set(numero, jid);
          },
          onMensagem,
        );
      }
    });

    return socket;
  }

  return {
    enviarMensagem: async (remetente: string, texto: string) => {
      const jid = jidsParaResponder.get(remetente);
      if (!jid) {
        console.error(`Nenhuma conversa conhecida ainda com ${remetente}; mensagem não enviada:`, texto);
        return;
      }
      await enviarParaJid(jid, texto);
    },
    enviarDocumento: async (remetente: string, buffer: Buffer, nomeArquivo: string, mimetype: string) => {
      const jid = jidsParaResponder.get(remetente);
      if (!jid) {
        console.error(`Nenhuma conversa conhecida ainda com ${remetente}; documento não enviado:`, nomeArquivo);
        return;
      }
      await enviarDocumentoParaJid(jid, buffer, nomeArquivo, mimetype);
    },
  };
}

// Identifica qual número autorizado (do jeito que está no .env) corresponde
// ao JID remetente — seja pelo número de telefone (com variantes do "nono
// dígito") ou pelo LID resolvido para cada número. Retorna null se não for
// nenhum dos autorizados.
function identificarRemetente(
  remetenteJid: string,
  numerosAutorizados: string[],
  lidsPorNumero: Map<string, string>,
): string | null {
  if (remetenteJid.endsWith("@lid")) {
    const remetenteLid = remetenteJid.split("@")[0].split(":")[0];
    for (const numero of numerosAutorizados) {
      if (lidsPorNumero.get(numero) === remetenteLid) return numero;
    }
    return null;
  }

  const remetenteNumero = remetenteJid.split("@")[0].split(":")[0];
  for (const numero of numerosAutorizados) {
    if (variantesNumero(numero).includes(remetenteNumero)) return numero;
  }
  return null;
}

async function tratarMensagem(
  socket: WASocket,
  msg: WAMessage,
  numerosAutorizados: string[],
  lidsPorNumero: Map<string, string>,
  mensagensDoBot: Set<string>,
  enviarParaJid: (jid: string, texto: string) => Promise<void>,
  definirJidResposta: (numero: string, jid: string) => void,
  onMensagem: MensagemHandler,
): Promise<void> {
  try {
    if (msg.key.id && mensagensDoBot.has(msg.key.id)) {
      mensagensDoBot.delete(msg.key.id);
      return;
    }
    if (!msg.message) return;

    const remetenteJid = msg.key.remoteJid ?? "";
    if (remetenteJid.endsWith("@g.us")) return;

    const numero = identificarRemetente(remetenteJid, numerosAutorizados, lidsPorNumero);
    if (!numero) return;

    const texto = await obterTexto(socket, msg, remetenteJid, enviarParaJid);
    if (!texto) return;

    // Não aguardamos a confirmação de leitura: é só um "nice to have" e,
    // em alguns casos de borda (ex: self-chat com JID @lid), a chamada
    // pode nunca resolver nem rejeitar, travando o processamento.
    socket.readMessages([msg.key]).catch(() => {});

    // Responder sempre para o mesmo JID de onde a mensagem chegou.
    definirJidResposta(numero, remetenteJid);

    await onMensagem(texto.trim(), numero);
  } catch (err) {
    console.error("Erro ao tratar mensagem recebida:", err);
  }
}

// Números de celular brasileiros têm o "nono dígito" (55 + DDD + 9 dígitos),
// mas o WhatsApp às vezes representa a mesma conta sem ele (55 + DDD + 8
// dígitos). Aceita o número autorizado em ambos os formatos, não só no que
// foi digitado no .env.
function variantesNumero(numero: string): string[] {
  const variantes = new Set([numero]);

  if (numero.startsWith("55") && numero.length === 13 && numero[4] === "9") {
    variantes.add(numero.slice(0, 4) + numero.slice(5));
  }
  if (numero.startsWith("55") && numero.length === 12) {
    variantes.add(numero.slice(0, 4) + "9" + numero.slice(4));
  }

  return [...variantes];
}

function extrairTexto(msg: WAMessage): string | null {
  const conteudo = msg.message;
  if (!conteudo) return null;

  return (
    conteudo.conversation ??
    conteudo.extendedTextMessage?.text ??
    null
  );
}

async function obterTexto(
  socket: WASocket,
  msg: WAMessage,
  remetenteJid: string,
  enviarParaJid: (jid: string, texto: string) => Promise<void>,
): Promise<string | null> {
  const textoDireto = extrairTexto(msg);
  if (textoDireto) return textoDireto;

  const audioMessage = msg.message?.audioMessage;
  if (!audioMessage) return null;

  if (!duracaoValida(audioMessage.seconds)) {
    await enviarParaJid(
      remetenteJid,
      `Esse áudio é muito longo (mais de ${Math.round(DURACAO_MAXIMA_SEGUNDOS / 60)} minutos). Manda um mais curto ou por texto?`,
    );
    return null;
  }

  try {
    await enviarParaJid(remetenteJid, "🎙️ Transcrevendo seu áudio...");
    const buffer = await downloadMediaMessage(msg, "buffer", {}, {
      logger,
      reuploadRequest: socket.updateMediaMessage,
    });
    const texto = await transcreverAudio(buffer, audioMessage.mimetype);
    if (!texto) {
      await enviarParaJid(remetenteJid, "Não consegui entender esse áudio. Tenta de novo ou manda por texto?");
      return null;
    }
    return texto;
  } catch (err) {
    console.error("Erro ao transcrever áudio:", err);
    await enviarParaJid(remetenteJid, "Não consegui processar esse áudio. Tenta de novo ou manda por texto?");
    return null;
  }
}
