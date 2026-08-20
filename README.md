# Bot de Gestão Rural (WhatsApp)

Protótipo local de bot de WhatsApp para gestão de custos e atividades de uma propriedade
cafeeira (adubação, colheita, poda, defensivos, mão de obra, vendas). O produtor manda uma
mensagem em linguagem natural, o bot interpreta com IA, pede confirmação e grava num
banco SQLite local.

**Status:** MVP para validar o conceito. Roda só localmente (`npm run dev`), sem deploy,
sem hospedagem, sem webhook — conexão direta com o WhatsApp via QR code.

## Stack

- Node.js + TypeScript
- [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) — conexão não-oficial com o WhatsApp (QR code, sem API oficial/Business)
- **IA híbrida:** [`@google/genai`](https://github.com/googleapis/js-genai) (Gemini, modelo padrão/barato) + [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) (Claude, só para pedidos complexos) — ver [Roteador de IA](#roteador-de-ia-gemini--claude) abaixo
- `node:sqlite` (nativo do Node, sem dependência externa) — banco local em arquivo único
- `dotenv` — variáveis de ambiente

> Trocas em relação ao plano original: `better-sqlite3` → `node:sqlite` (evita compilar
> binário nativo) e `libsignal` (dependência do Baileys) resolvido via npm em vez de Git
> — ajustes feitos por causa de restrições do ambiente onde o projeto foi montado, não
> mudam nada do ponto de vista de uso.

## Como rodar

1. Instale as dependências:
   ```
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha:
   ```
   ANTHROPIC_API_KEY=sua-chave-aqui
   CLAUDE_MODEL=claude-opus-5

   GEMINI_API_KEY=sua-chave-aqui
   GEMINI_MODEL=gemini-3.5-flash-lite

   WHATSAPP_NUMEROS_AUTORIZADOS=5535999999999,5535988888888
   ```
   Um ou mais números (separados por vírgula) que podem falar com o bot — só dígitos
   (código do país + DDD + número), sem `+`, sem espaços. Os nomes de modelo mudam com o
   tempo — se algum ficar indisponível, é só trocar aqui, não tem nada disso espalhado
   pelo código.
3. Rode:
   ```
   npm run dev
   ```
4. Escaneie o QR code exibido no terminal com o WhatsApp (Aparelhos conectados →
   Conectar um aparelho). A sessão fica salva em `auth_info/` — não precisa escanear de
   novo nas próximas vezes, a menos que desconecte a sessão pelo celular.

## Número do bot vs. números autorizados

O ideal é ter um número **dedicado** pro bot (o que é escaneado no QR), separado dos
números que vão efetivamente mandar mensagem — coloque um ou mais desses últimos em
`WHATSAPP_NUMEROS_AUTORIZADOS`. Cada número autorizado tem sua própria confirmação
pendente e memória de acompanhamento (`src/index.ts`), então duas pessoas podem usar o
bot ao mesmo tempo sem uma interferir na conversa da outra — a resposta sempre volta
pra conversa de quem mandou a mensagem, nunca é cruzada entre os dois.

## Fluxo

1. Produtor manda uma mensagem em texto livre, ex: *"Comprei 10 sacos de NPK por R$1500 no talhão 3"*.
2. O bot manda o texto para a Claude, que extrai os dados estruturados (schema abaixo) e responde com um resumo:
   ```
   Entendi o seguinte:

   Data: 2026-08-19
   Categoria: adubacao
   Item: NPK 20-05-20
   Quantidade: 10 sacos
   Custo: R$ 1.500,00
   Talhão: Talhão 3

   Confirma? Responda "sim" ou "corrigir".
   ```
3. Se a resposta for **"sim"** (case-insensitive), o registro é gravado no banco e o bot responde "Registrado!".
4. Qualquer outra resposta descarta o registro pendente e trata a mensagem seguinte como uma nova tentativa de extração.
5. Comandos especiais, reconhecidos direto por texto (não passam pela IA):
   - **"relatório"** ou **"relatorio"** → resumo do mês atual (texto)
   - **"relatório mês passado"** → resumo do mês anterior (texto)
   - **"relatório em pdf"** / **"relatório pdf mês passado"** → mesma coisa, como um PDF anexado (ver seção "Relatório em PDF")
   - **"uso de ia"** → chamadas, tokens e custo estimado do mês atual (ver seção "Uso e custo de IA")
   - **"uso de ia mês passado"** → mesma coisa, mês anterior

   O relatório mostra: total gasto (soma de custo, exceto categoria `venda`), total
   colhido (somado por unidade) e um detalhamento por categoria.

## Perguntas sobre os dados

Além de registrar, o bot responde perguntas em linguagem natural sobre o que já foi
registrado — sempre com dados reais do SQLite, nunca inventados. Exemplos:

- "Quanto gastei com adubo esse mês?"
- "Quanto colhi este mês?"
- "Qual talhão produziu mais?"
- "Quanto vendi esse ano?"
- "Quanto gastei no talhão 3?"

Como funciona: a IA (Gemini ou Claude, ver seção abaixo) decide qual consulta chamar
(`consultar_gastos`, `consultar_producao`, `consultar_vendas` ou `consultar_registros`,
definidas em `src/tools.ts`) e com quais parâmetros (incluindo o período, resolvido a
partir de expressões como "mês passado" ou "este ano"), mas quem executa a query no
banco é sempre o código em `src/db.ts` — a IA nunca roda SQL diretamente. Se faltar uma
informação (ex: o período), o bot pergunta antes de responder, e se não houver dados
para o período pedido, ele diz isso em vez de estimar. Mensagens sem nenhuma das duas
intenções (registrar ou consultar) — tipo um simples "oi" — recebem uma resposta
conversacional direta.

## Roteador de IA (Gemini + Claude)

O bot usa dois provedores de IA através de uma interface comum (`src/ai/types.ts`):

- **Gemini** (`src/ai/gemini-provider.ts`) — modelo padrão, usado na grande maioria das
  mensagens (registrar, consultar). Mais barato.
- **Claude** (`src/ai/claude-provider.ts`) — reservado para pedidos que pedem raciocínio
  mais profundo (ex: "faça uma análise completa dos meus custos e explique o que mais
  impactou", "compare minha produção entre os últimos anos").

Quem decide qual dos dois usar é o `AIRouter` (`src/ai/router.ts`), com uma heurística
local (sem custo de IA) baseada em palavras-chave de análise/comparação e tamanho da
mensagem — não é um LLM classificando cada mensagem, porque isso anularia a economia de
rotear pro modelo mais barato. Se o provedor escolhido falhar (erro de rede, indisponível,
etc.), o router tenta uma vez o outro automaticamente antes de desistir.

Pedidos mais abertos (ex: "análise completa") podem exigir mais de uma consulta em
sequência — a Claude olha um resumo, decide que precisa de mais detalhe, consulta de
novo, e só então responde. O router suporta até 4 rodadas de ferramentas nessa mesma
mensagem antes de forçar uma resposta.

Ambos os provedores usam exatamente as mesmas ferramentas (`src/tools.ts`) e a mesma
regra de nunca inventar dados — a escolha de qual IA responde não muda o que o bot pode
fazer, só o custo/qualidade de cada resposta.

### Uso e custo de IA

Toda chamada a qualquer um dos dois providers grava tokens de entrada/saída e (se os
preços estiverem configurados) o custo estimado numa tabela local (`ai_usage`, sem
guardar o conteúdo da mensagem). Mande **"uso de ia"** ou **"uso de ia mês passado"**
pelo WhatsApp pra ver o resumo do período — mesmo padrão do comando "relatório", não
passa por nenhuma IA (então consultar isso não gera custo).

O custo é estimado a partir de `CLAUDE_INPUT_PRICE_PER_MILLION` /
`CLAUDE_OUTPUT_PRICE_PER_MILLION` / `GEMINI_INPUT_PRICE_PER_MILLION` /
`GEMINI_OUTPUT_PRICE_PER_MILLION` no `.env` (preço por 1 milhão de tokens, em dólar —
Anthropic e Google cobram em USD, não em reais). Preços mudam com o tempo, por isso não
tem nada fixo no código — se algum não estiver configurado, o relatório mostra os tokens
mas avisa que o custo daquele provider não pôde ser estimado, em vez de chutar um valor.

### Relatório em PDF

Mande **"relatório em pdf"** (ou "relatório pdf mês passado") que o bot gera um PDF
(`src/pdf.ts`, biblioteca `pdfkit` — sem depender de navegador/Chromium, leve o
suficiente pra rodar numa VM de 1GB) com cabeçalho, cartões de resumo (total gasto,
total colhido) e uma tabela detalhada por categoria, e manda como arquivo anexado no
WhatsApp. Usa os mesmos dados/cálculos do relatório em texto (`src/reports.ts`) — não
tem nenhuma IA envolvida na geração, então não gera custo além do processamento local.

## Schema do banco (`entries`, SQLite em `data/gestao.db`)

| Campo                | Tipo    | Observação                                                              |
|-----------------------|---------|--------------------------------------------------------------------------|
| `id`                  | INTEGER | autoincrement                                                            |
| `data`                | TEXT    | `YYYY-MM-DD`                                                             |
| `categoria`           | TEXT    | `adubacao \| colheita \| poda \| defensivo \| mao_de_obra \| venda \| outro` |
| `item`                | TEXT    | nullable                                                                 |
| `quantidade`          | REAL    | nullable                                                                 |
| `unidade`             | TEXT    | nullable (ex: "sacos", "kg", "litros")                                  |
| `custo`               | REAL    | nullable                                                                 |
| `talhao`              | TEXT    | nullable                                                                 |
| `observacao`          | TEXT    | nullable                                                                 |
| `mensagem_original`   | TEXT    | texto bruto enviado pelo produtor, para auditoria                       |
| `criado_em`           | TEXT    | timestamp ISO de quando o registro foi gravado                          |

## Estrutura de pastas

```
src/
  ai/
    types.ts             # interface AIProvider comum e tipos compartilhados
    gemini-provider.ts    # implementação via @google/genai
    claude-provider.ts    # implementação via @anthropic-ai/sdk
    router.ts             # AIRouter: escolhe o provider e faz fallback
  db.ts        # setup e queries do SQLite (registro + consultas)
  tools.ts     # ferramentas expostas à IA (tool-use) e o despachante que as executa
  parser.ts    # monta o prompt/ferramentas e delega ao AIRouter (registrar, consultar ou conversar)
  audio.ts     # transcrição de áudio via Gemini (entende OGG/Opus nativamente)
  whatsapp.ts  # conexão Baileys (QR, filtro de remetente, áudio, envio/recebimento)
  reports.ts   # geração dos relatórios mensais (texto)
  pdf.ts       # geração do relatório mensal em PDF (pdfkit)
  index.ts     # orquestração (fluxo de confirmação, comandos especiais)
auth_info/     # sessão do WhatsApp (gerada automaticamente, git-ignored)
data/          # banco SQLite (gerado automaticamente, git-ignored)
```

## Áudio

O produtor pode mandar uma mensagem de voz em vez de texto. A transcrição é feita pelo
**Gemini** (`src/audio.ts`) — ele entende áudio nativamente, incluindo OGG/Opus (o
formato que o WhatsApp usa pra mensagem de voz), sem precisar decodificar ou rodar
nenhum modelo local. O texto transcrito passa pelo mesmo fluxo de registrar/consultar de
sempre. Um único áudio ainda vira um único registro (várias informações num áudio só,
tipo "colhi X e gastei Y", ficam para uma fase futura). Áudios com mais de 3 minutos são
recusados com um aviso.

> Versão anterior usava Whisper local (`@huggingface/transformers` + `ffmpeg-static`),
> rodando 100% offline e sem custo por áudio. Trocamos pelo Gemini porque o Whisper
> mantém um modelo (~150MB) carregado em memória, o que é problemático em VMs pequenas
> (ex: a camada gratuita "Always Free" da Oracle Cloud tem só 1GB de RAM na shape mais
> básica) — o objetivo era viabilizar rodar o bot 24h numa VM barata/gratuita. A
> transcrição por Gemini consome tokens (bem barato) e envia o áudio para o Google, em
> vez de rodar local.

## Limitações conhecidas do MVP

- Vários números autorizados, mas sem conceito de propriedades/talhões separados por
  usuário — todo mundo em `WHATSAPP_NUMEROS_AUTORIZADOS` vê e registra na mesma base.
- Confirmação pendente e memória de acompanhamento de perguntas ficam em memória
  (`Map`); reiniciar o bot descarta qualquer confirmação ou pergunta em aberto.
- Sem controle de estoque — não há como responder "quantas sacas ainda tenho".
- Sem correção/exclusão de registros já salvos, sem exportação em Excel, sem memória
  persistente da propriedade (talhões, hectares) — fases seguintes.
- Tem métricas de uso/custo (comando "uso de ia"), mas ainda sem limite de orçamento
  mensal configurável nem qualquer ação automática (ex: priorizar Gemini) perto de um
  limite — é só visibilidade por enquanto.
- Fallback entre Gemini e Claude é "tenta uma vez o outro"; sem retry com backoff
  exponencial nem tratamento fino de rate limit.
- Sem testes automatizados — é um protótipo para validar o conceito, não uma versão de
  produção.
