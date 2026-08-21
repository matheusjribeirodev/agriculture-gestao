import "dotenv/config";
import { initDb } from "./db";
import { interpretarMensagem, type TrocaAnterior } from "./parser";
import { conectarWhatsApp } from "./whatsapp";
import { gerarRelatorioUsoIAMesAtual, gerarRelatorioUsoIAMesPassado } from "./reports";
import { PROJETOS } from "./projects/registry";
import { ehProjetoValido, type Projeto, type ProjetoDef, type RegistroSalvo } from "./projects/types";

// Mapa número → projeto(s) que ele pode usar, formato:
// "numero:projeto1,projeto2|numero2:projeto3" — substitui a antiga lista
// simples WHATSAPP_NUMEROS_AUTORIZADOS. Número fora daqui continua barrado.
function lerPermissoesProjeto(): Map<string, Projeto[]> {
  const bruto = process.env.PERMISSOES_PROJETO;
  const permissoes = new Map<string, Projeto[]>();
  if (!bruto) return permissoes;

  for (const par of bruto.split("|")) {
    const [numero, listaProjetos] = par.split(":");
    if (!numero || !listaProjetos) continue;
    const projetos = listaProjetos
      .split(",")
      .map((p) => p.trim())
      .filter(ehProjetoValido);
    if (projetos.length > 0) {
      permissoes.set(numero.trim(), projetos);
    }
  }
  return permissoes;
}

const permissoesProjeto = lerPermissoesProjeto();
const numerosAutorizados = [...permissoesProjeto.keys()];
if (numerosAutorizados.length === 0) {
  throw new Error("Defina PERMISSOES_PROJETO no arquivo .env (ex: 5535999999999:gestao_rural)");
}

interface ConfirmacaoPendente {
  projeto: ProjetoDef;
  dados: Record<string, unknown>;
  mensagemOriginal: string;
}

// Uma entrada por número autorizado — cada pessoa tem sua própria
// confirmação pendente e memória de acompanhamento, sem interferir uma na
// outra.
const pendentes = new Map<string, ConfirmacaoPendente>();

// Guarda a última pergunta de esclarecimento do bot (quando ele não teve
// dados suficientes pra consultar nada) para dar contexto na próxima
// mensagem — ver TrocaAnterior em parser.ts.
const contextoPendente = new Map<string, TrocaAnterior>();

interface ExclusaoPendente {
  projeto: ProjetoDef;
  itens: Map<number, RegistroSalvo>;
}

// Lista numerada de registros recentes aguardando escolha de qual excluir —
// também por número autorizado, e também perdida em restart (mesma lógica
// de `pendentes`).
const exclusoesPendentes = new Map<string, ExclusaoPendente>();

// Projeto ativo por número (só relevante pra quem tem mais de um liberado
// em PERMISSOES_PROJETO) — em memória, perdido no restart (mesma limitação
// já documentada de `pendentes`/`exclusoesPendentes`), volta pro padrão
// `gestao_rural`.
const projetoAtivo = new Map<string, Projeto>();

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

// Comando de troca exige a mensagem inteira ser (só) o nome do projeto —
// de propósito não é um `.includes()`: "propriedade" aparece com frequência
// dentro de frases normais de registro/consulta ("gastei com a
// propriedade"), então um match solto hijackaria essas mensagens.
function ehComandoTroca(normalizado: string): Projeto | null {
  const semPrefixo = normalizado.replace(/^projeto\s+/, "");
  if (semPrefixo === "financas" || semPrefixo === "financeiro") return "financas_pessoais";
  if (semPrefixo === "propriedade" || semPrefixo === "rural") return "gestao_rural";
  return null;
}

function formatarListaExclusao(projeto: ProjetoDef, itens: RegistroSalvo[]): string {
  const linhas = ['🗑️ Qual registro deseja excluir? Responda com o número ou "cancelar".', ""];
  itens.forEach((item, i) => {
    linhas.push(`${i + 1}. ${projeto.formatarLinhaRegistro(item)}`);
  });
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
  const projetosPermitidos = permissoesProjeto.get(remetente) ?? [];

  const projetoAlvo = ehComandoTroca(normalizado);
  if (projetoAlvo) {
    if (!projetosPermitidos.includes(projetoAlvo)) {
      await responder("Você não tem acesso a esse projeto.");
      return;
    }
    projetoAtivo.set(remetente, projetoAlvo);
    // Evita uma confirmação/exclusão/pergunta em aberto de um projeto vazar
    // pro outro depois da troca.
    pendentes.delete(remetente);
    exclusoesPendentes.delete(remetente);
    contextoPendente.delete(remetente);
    await responder(`Modo: ${PROJETOS[projetoAlvo].nomeExibicao} ✅`);
    return;
  }

  const projeto = PROJETOS[projetoAtivo.get(remetente) ?? "gestao_rural"];

  if (normalizado.includes("uso de ia") || normalizado.includes("uso da ia") || normalizado.includes("consumo de ia")) {
    const relatorio = await (normalizado.includes("passado")
      ? gerarRelatorioUsoIAMesPassado()
      : gerarRelatorioUsoIAMesAtual());
    await responder(relatorio);
    return;
  }

  if (normalizado.includes("relatorio")) {
    const querPdf = normalizado.includes("pdf");
    const offsetMeses = normalizado.includes("passado") ? -1 : 0;

    if (querPdf) {
      await responder("📄 Gerando o PDF, só um instante...");
      const { buffer, nomeArquivo } = await projeto.gerarRelatorioPdf(offsetMeses);
      await enviarDocumento(remetente, buffer, nomeArquivo, "application/pdf");
      return;
    }

    const relatorio = await projeto.gerarRelatorioTexto(offsetMeses);
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
      await exclusaoPendente.projeto.excluirPorId(escolhido.id);
      await responder(`Excluído: ${exclusaoPendente.projeto.formatarLinhaRegistro(escolhido)}`);
      return;
    }

    await responder('Não entendi. Responda com o número do registro que deseja excluir, ou "cancelar".');
    return;
  }

  if (ehPedidoExclusao(normalizado)) {
    const recentes = await projeto.listarRecentes(10);
    if (recentes.length === 0) {
      await responder("Não há registros para excluir.");
      return;
    }
    const itens = new Map<number, RegistroSalvo>();
    recentes.forEach((item, i) => itens.set(i + 1, item));
    exclusoesPendentes.set(remetente, { projeto, itens });
    await responder(formatarListaExclusao(projeto, recentes));
    return;
  }

  const pendente = pendentes.get(remetente);

  if (pendente) {
    if (ehConfirmacaoPositiva(normalizado)) {
      pendentes.delete(remetente);
      const dados = { ...pendente.dados, mensagem_original: pendente.mensagemOriginal };
      await pendente.projeto.inserir(dados);
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

  const resultado = await interpretarMensagem(texto, projeto, trocaAnterior);

  if (resultado.tipo === "registrar") {
    pendentes.set(remetente, { projeto, dados: resultado.dados, mensagemOriginal: texto });
    await responder(projeto.formatarResumoConfirmacao(resultado.dados));
    return;
  }

  if (resultado.tipo === "gerar_pdf") {
    await responder("📄 Gerando o PDF, só um instante...");
    const { buffer, nomeArquivo } = await projeto.gerarRelatorioPdf(resultado.offsetMeses, resultado.extra);
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
