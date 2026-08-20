import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  areJidsSameUser,
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

export type MensagemHandler = (texto: string) => Promise<void>;

export interface WhatsAppConexao {
  enviarMensagem: (texto: string) => Promise<void>;
}

interface ContaPropria {
  id?: string;
  lid?: string;
}

export async function conectarWhatsApp(
  numeroAutorizado: string,
  onMensagem: MensagemHandler,
): Promise<WhatsAppConexao> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  let sock: WASocket = iniciarSocket();

  // IDs de mensagens enviadas pelo próprio bot, para não reprocessá-las
  // como se fossem mensagens novas (relevante em modo self-chat, onde o
  // número autorizado é o mesmo número conectado ao WhatsApp).
  const mensagensDoBot = new Set<string>();

  // JID da conversa da última mensagem válida recebida — respondemos
  // sempre nesse mesmo JID, em vez de reconstruir um a partir do número
  // autorizado. Isso evita problemas com o "nono dígito" de números
  // brasileiros e com contas onde o WhatsApp usa LID em vez do número
  // de telefone (ex: self-chat).
  let jidParaResponder: string | null = null;

  // LID do número autorizado, resolvido via sock.onWhatsApp() assim que a
  // conexão abre. Quando as duas contas ainda não "se conhecem" o
  // suficiente, o WhatsApp identifica o remetente pelo LID em vez do
  // número de telefone — sem isso, não teríamos como saber que é a mesma
  // pessoa.
  let numeroAutorizadoLid: string | null = null;

  async function enviarParaJid(jid: string, texto: string): Promise<void> {
    const enviada = await sock.sendMessage(jid, { text: texto });
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
        socket
          .onWhatsApp(`${numeroAutorizado}@s.whatsapp.net`)
          .then((resultados) => {
            const lid = resultados?.[0]?.lid;
            if (typeof lid === "string") {
              numeroAutorizadoLid = lid.split("@")[0].split(":")[0];
            }
          })
          .catch((err) => console.error("Erro ao resolver LID do número autorizado:", err));
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

      // Lido a cada evento: o Baileys preenche/atualiza `creds.me.lid`
      // (identificador interno da própria conta) ao longo da sessão.
      const contaPropria: ContaPropria = {
        id: state.creds.me?.id,
        lid: state.creds.me?.lid,
      };

      for (const msg of messages) {
        await tratarMensagem(
          socket,
          msg,
          numeroAutorizado,
          numeroAutorizadoLid,
          contaPropria,
          mensagensDoBot,
          enviarParaJid,
          (jid) => {
            jidParaResponder = jid;
          },
          onMensagem,
        );
      }
    });

    return socket;
  }

  return {
    enviarMensagem: async (texto: string) => {
      if (!jidParaResponder) {
        console.error("Nenhuma conversa conhecida ainda; mensagem não enviada:", texto);
        return;
      }
      await enviarParaJid(jidParaResponder, texto);
    },
  };
}

async function tratarMensagem(
  socket: WASocket,
  msg: WAMessage,
  numeroAutorizado: string,
  numeroAutorizadoLid: string | null,
  contaPropria: ContaPropria,
  mensagensDoBot: Set<string>,
  enviarParaJid: (jid: string, texto: string) => Promise<void>,
  definirJidResposta: (jid: string) => void,
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

    // Self-chat ("Mensagem para você mesmo"): o WhatsApp pode representar
    // essa conversa com o LID da própria conta (ex: "123...@lid") em vez
    // do número de telefone, dependendo da conta. Comparamos com a
    // identidade da própria conta (id ou lid) em vez do número autorizado.
    const ehSelfChat =
      msg.key.fromMe === true &&
      ((!!contaPropria.lid && areJidsSameUser(remetenteJid, contaPropria.lid)) ||
        (!!contaPropria.id && areJidsSameUser(remetenteJid, contaPropria.id)));

    if (!ehSelfChat) {
      // fromMe=true aqui significa mensagem enviada por nós para outro
      // contato (não é o bot nem self-chat) — não é entrada do produtor.
      if (msg.key.fromMe) return;

      if (remetenteJid.endsWith("@lid")) {
        const remetenteLid = remetenteJid.split("@")[0].split(":")[0];
        if (!numeroAutorizadoLid || remetenteLid !== numeroAutorizadoLid) return;
      } else {
        // Remove sufixo de dispositivo (ex: "5535998597534:31@s.whatsapp.net")
        const remetenteNumero = remetenteJid.split("@")[0].split(":")[0];
        if (!variantesNumero(numeroAutorizado).includes(remetenteNumero)) return;
      }
    }

    const texto = await obterTexto(socket, msg, remetenteJid, enviarParaJid);
    if (!texto) return;

    // Não aguardamos a confirmação de leitura: é só um "nice to have" e,
    // em alguns casos de borda (ex: self-chat com JID @lid), a chamada
    // pode nunca resolver nem rejeitar, travando o processamento.
    socket.readMessages([msg.key]).catch(() => {});

    // Responder sempre para o mesmo JID de onde a mensagem chegou.
    definirJidResposta(remetenteJid);

    await onMensagem(texto.trim());
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
