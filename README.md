# Bot de Gestão Rural + Finanças Pessoais (WhatsApp)

Bot de WhatsApp multi-projeto: hoje cobre **gestão rural** (custos/receitas/produção de
uma propriedade — lavoura de café e o resto da propriedade, sempre separados por área) e
**finanças pessoais** (despesas/receitas do dia a dia, por categoria e forma de
pagamento). Cada número autorizado só enxerga os projetos liberados pra ele, sem misturar
dados entre projetos. Quem manda a mensagem em linguagem natural, o bot interpreta com
IA, pede confirmação e grava num banco Postgres (Supabase) — cada projeto na sua própria
tabela.

**Status:** Em produção — rodando 24/7 numa VM Oracle Cloud (Ubuntu, camada gratuita
"Always Free") via `pm2`, atendendo produtores reais por WhatsApp. Conexão direta com o
WhatsApp via QR code, sem API oficial/Business, sem webhook.

## Stack

- Node.js + TypeScript
- [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) — conexão não-oficial com o WhatsApp (QR code, sem API oficial/Business)
- **IA híbrida:** [`@google/genai`](https://github.com/googleapis/js-genai) (Gemini, modelo padrão/barato) + [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) (Claude, só para pedidos complexos) — ver [Roteador de IA](#roteador-de-ia-gemini--claude) abaixo
- [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) — banco Postgres hospedado no Supabase (schema/migrations gerenciados lá, acesso via `service_role` key)
- `dotenv` — variáveis de ambiente

> Trocas em relação ao plano original: `better-sqlite3` → `node:sqlite` → Supabase/Postgres
> (a versão local em SQLite rodou bem como MVP, mas a migração pro Supabase abriu caminho
> pra acessar os mesmos dados de um site, além de tirar o backup manual do arquivo `.db`
> da equação) e `libsignal` (dependência do Baileys) resolvido via npm em vez de Git.

## Como rodar

1. Instale as dependências:
   ```
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha:
   ```
   ANTHROPIC_API_KEY=sua-chave-aqui
   CLAUDE_MODEL=claude-sonnet-5

   GEMINI_API_KEY=sua-chave-aqui
   GEMINI_MODEL=gemini-3.5-flash-lite

   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key-aqui

   PERMISSOES_PROJETO=5535999999999:gestao_rural|5535988888888:gestao_rural,financas_pessoais
   ```
   `PERMISSOES_PROJETO` mapeia número → projeto(s) liberado(s) — números separados por
   `|`, projetos de um mesmo número separados por `,` (só dígitos no número: código do
   país + DDD + número, sem `+`, sem espaços; projetos válidos: `gestao_rural`,
   `financas_pessoais`). Número fora daqui é barrado, igual antes. Os nomes de modelo
   mudam com o tempo — se algum ficar indisponível, é só trocar aqui, não tem nada disso
   espalhado pelo código. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ficam em Project
   Settings → API no painel do Supabase — a `service_role` key ignora RLS, então nunca
   deve ser exposta em código client-side, só usada aqui no backend.
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
`PERMISSOES_PROJETO`. Cada número autorizado tem sua própria confirmação pendente e
memória de acompanhamento (`src/index.ts`), então várias pessoas podem usar o bot ao
mesmo tempo sem uma interferir na conversa da outra — a resposta sempre volta pra
conversa de quem mandou a mensagem, nunca é cruzada entre elas.

## Projetos e troca de contexto

O bot atende dois projetos, cada um com seu próprio schema, categorias, ferramentas de
IA e relatório — `src/projects/gestao-rural/` e `src/projects/financas-pessoais/` (ver
"Estrutura de pastas" abaixo). O que é genérico (autorização, roteador de IA,
confirmação sim/corrigir/não, exclusão numerada, "uso de ia", WhatsApp/áudio) é
compartilhado; o que muda por projeto fica isolado dentro do módulo dele, sem vazar dado
de um pro outro.

- Número liberado pra **um projeto só** (via `PERMISSOES_PROJETO`) sempre fala direto com
  ele, sem comando de troca disponível.
- Número liberado pros **dois** tem um "projeto ativo" (padrão: `gestao_rural`), trocado
  por dois comandos reconhecidos por palavra-chave — não passam pela IA, e exigem a
  mensagem ser só o comando (evita que uma frase comum tipo "gastei com a propriedade"
  seja confundida com o comando de troca):
  - **"financas"** ou **"projeto financas"** → muda para `financas_pessoais`
  - **"propriedade"** ou **"projeto propriedade"** → volta para `gestao_rural`

  Trocar de projeto limpa qualquer confirmação, exclusão pendente ou pergunta em aberto
  desse número — evita misturar o fluxo de um projeto com o outro. Pedir um projeto sem
  permissão responde "Você não tem acesso a esse projeto." em vez de trocar. O projeto
  ativo fica em memória (mesma lógica de `pendentes`/`exclusoesPendentes`) — reiniciar o
  bot volta todo mundo pro padrão `gestao_rural`.

## Fluxo

1. Produtor manda uma mensagem em texto livre, ex: *"Comprei 10 sacos de NPK por R$1500 no talhão 3"*.
2. O bot manda o texto para a IA, que decide a área (`cafe`, `propriedade` ou `outro`) e
   extrai os dados estruturados (schema abaixo), respondendo com um resumo:
   ```
   Entendi o seguinte:

   Data: 19/08/2026
   Área: cafe
   Categoria: adubacao
   Item: NPK 20-05-20
   Quantidade: 10 sacos
   Custo: R$ 1.500,00
   Local: Talhão 3

   Confirma? Responda "sim", "corrigir" ou "não".
   ```
   Para uma venda, a linha correspondente aparece como **Receita** em vez de **Custo** —
   venda é entrada de dinheiro, não gasto.
3. Se a resposta for **"sim"** (case-insensitive, tolera variações tipo "confirmo", "pode confirmar"), o registro é gravado no banco e o bot responde "Registrado!".
4. Se a resposta for **"não"** (ou variações: "nao", "cancelar", "esquece"), o registro pendente é descartado e o bot avisa que nada foi salvo.
5. Se a resposta for **"corrigir"** (ou variações: "corrige", "errado"), o registro pendente é descartado e o bot pede a informação correta.
6. Qualquer outra resposta (não reconhecida como nenhuma das três acima) **não** descarta o registro pendente — o bot pede de novo, mantendo a confirmação em aberto até chegar uma resposta reconhecida.
7. Comandos especiais, reconhecidos direto por texto (não passam pela IA):
   - **"relatório"** ou **"relatorio"** → resumo do mês atual (texto)
   - **"relatório mês passado"** → resumo do mês anterior (texto)
   - **"relatório em pdf"** / **"relatório pdf mês passado"** → mesma coisa, como um PDF anexado (ver seção "Relatório em PDF") — mas isso é só um atalho de texto; pedir o PDF de qualquer outro jeito ("manda um pdf", "pode gerar um arquivo?") também funciona, via ferramenta de IA
   - **"uso de ia"** → chamadas, tokens e custo estimado do mês atual (ver seção "Uso e custo de IA")
   - **"uso de ia mês passado"** → mesma coisa, mês anterior
   - **"excluir registro"** / "apagar lançamento" (qualquer conjugação de apagar/excluir/deletar/remover + registro/lançamento/entrada) → lista os 10 registros mais recentes numerados para escolher qual excluir (ver seção "Excluir registro")

   O relatório é organizado por área — cada uma com suas próprias despesas, receita
   (vendas) e total colhido, detalhado por categoria — e termina com um resumo geral
   (despesa total, receita total, saldo). Áreas sem nenhum lançamento no período não
   aparecem.

## Perguntas sobre os dados

Além de registrar, o bot responde perguntas em linguagem natural sobre o que já foi
registrado — sempre com dados reais do Supabase, nunca inventados. Exemplos:

- "Quanto gastei com adubo esse mês?"
- "Quanto colhi este mês?"
- "Qual local produziu mais?"
- "Quanto vendi esse ano?"
- "Quanto gastei no talhão 3?"
- "Quanto gastei na propriedade esse mês?" (fora do café)

Como funciona: a IA (Gemini ou Claude, ver seção abaixo) decide qual consulta chamar
(`consultar_gastos`, `consultar_producao`, `consultar_vendas` ou `consultar_registros`,
definidas em `src/projects/gestao-rural/tools.ts`) e com quais parâmetros (incluindo o
período, resolvido a partir de expressões como "mês passado" ou "este ano", e
opcionalmente a área e o local), mas quem executa a query no banco é sempre o código em
`src/projects/gestao-rural/db.ts` — a IA nunca roda SQL diretamente. Quando o produtor
não pede uma área específica, as consultas
retornam o total geral **e** o detalhamento por área junto — nunca um número só
misturando café com o resto da propriedade sem dizer a origem. Se faltar uma informação
(ex: o período), o bot pergunta antes de responder, e se não houver dados para o
período pedido, ele diz isso em vez de estimar. Mensagens sem nenhuma das intenções
acima (registrar, consultar, pedir PDF) — tipo um simples "oi" — recebem uma resposta
conversacional direta.

Em **finanças pessoais** (`src/projects/financas-pessoais/`) o mesmo padrão vale para
`consultar_gastos`, `consultar_receitas`, `consultar_por_forma_pagamento` e
`consultar_registros` — exemplos: "quanto gastei com mercado esse mês?", "quanto recebi
de salário esse ano?", "quanto paguei no cartão de crédito esse mês?".

### Preço do café (mercado externo)

Pergunte **"qual o preço do café hoje?"** (ou similar) que o bot busca a cotação do café
arábica tipo 6/7 bebida dura direto do site [Notícias Agrícolas](https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-duro)
(`src/projects/gestao-rural/cotacao.ts`, ferramenta `consultar_preco_cafe`, só no
projeto `gestao_rural`) — por município/cooperativa, com a
data do último fechamento. Mesma regra de sempre: a IA nunca inventa um preço, só usa o
que veio da página; se algum município estiver "s/ cotação", o bot avisa em vez de
estimar. O resultado fica em cache por 15 minutos (evita bater na página a cada pergunta
seguida, já que o preço só fecha uma vez por dia útil).

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

Ambos os provedores usam exatamente as mesmas ferramentas — as do **projeto ativo** de
quem mandou a mensagem (ver "Projetos e troca de contexto" acima) — e a mesma regra de
nunca inventar dados. A escolha de qual IA responde não muda o que o bot pode fazer, só
o custo/qualidade de cada resposta.

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
(biblioteca `pdfkit` — sem depender de navegador/Chromium, leve o suficiente pra rodar
numa VM de 1GB) com cabeçalho, cartões de resumo e uma tabela por categoria, rodapé com
data de geração e numeração de página. Os primitivos de desenho (cabeçalho, cartão,
rodapé, paginação — inclusive a lógica de quebra de página, que já teve um bug corrigido)
ficam em `src/pdf-shared.ts`, compartilhados pelos dois projetos; cada um desenha seu
próprio conteúdo (`src/projects/gestao-rural/pdf.ts` — despesa/receita/saldo/colhido por
área — e `src/projects/financas-pessoais/pdf.ts` — despesa/receita/saldo por categoria e
por forma de pagamento).

Esse comando exato é só um atalho rápido (evita gastar tokens de IA no caso óbvio) — na
prática, qualquer pedido de PDF/arquivo/documento passa pela ferramenta de IA
`gerar_relatorio_pdf` de cada projeto, então frases como "manda esse relatório em pdf"
ou "pode gerar um pdf só do café?" também funcionam (o filtro por área só existe na
gestão rural). Em nenhum dos dois caminhos há IA envolvida na geração do PDF em si (só,
no caso do segundo, para entender o pedido) — o desenho e os cálculos são sempre locais.

## Excluir registro

Mande **"excluir registro"**, "apagar lançamento" ou qualquer variação (funciona com
qualquer conjugação de apagar/excluir/deletar/remover, seguida de
registro/lançamento/entrada) que o bot lista os 10 registros mais recentes numerados,
mais recente primeiro:

```
🗑️ Qual registro deseja excluir? Responda com o número ou "cancelar".

1. 20/08/2026 - cafe - colheita - café - 200 sacas - R$ 0,00
2. 19/08/2026 - propriedade - manutencao - óleo do trator - R$ 300,00
...
```

Responda com o número pra excluir aquele registro (apaga direto do banco, sem uma
segunda confirmação) ou **"cancelar"** pra sair sem apagar nada. Uma resposta que não
seja nem um número da lista nem "cancelar" reexibe o pedido sem descartar a lista. Esse
comando não passa por nenhuma IA — é reconhecido por palavra-chave, e a busca/exclusão
são só um `SELECT`/`DELETE` direto, no projeto ativo de quem mandou a mensagem
(`listarRecentes`/`excluirPorId` de cada módulo em `src/projects/`). A lista numerada
(qual número corresponde a qual registro) fica em memória por número autorizado
(`src/index.ts`), igual à confirmação de registro — reiniciar o bot com uma exclusão
pendente descarta essa lista.

## Schema do banco (Postgres/Supabase, projeto "Gestao Finanças")

Cada projeto tem sua própria tabela, sem relação entre elas — é o que garante que dado
de um não vaza pro relatório/consulta do outro.

Tabela `entries` (`gestao_rural`):

| Campo                | Tipo         | Observação                                                              |
|-----------------------|--------------|--------------------------------------------------------------------------|
| `id`                  | integer      | identity, autoincrement                                                  |
| `data`                | date         | volta do cliente Supabase como string `YYYY-MM-DD`                       |
| `area`                | text         | `cafe \| propriedade \| outro` — CHECK constraint                        |
| `categoria`           | text         | depende da área — CHECK constraint espelha `CATEGORIAS_POR_AREA` em `src/projects/gestao-rural/db.ts` |
| `item`                | text         | nullable                                                                 |
| `quantidade`          | numeric      | nullable                                                                 |
| `unidade`             | text         | nullable (ex: "sacos", "kg", "litros")                                  |
| `custo`               | numeric      | nullable — para categoria `venda`, é o valor recebido (receita)         |
| `local`               | text         | nullable — local dentro da propriedade (ex: "Talhão 3", "Curral")       |
| `observacao`          | text         | nullable                                                                 |
| `mensagem_original`   | text         | texto bruto enviado pelo produtor, para auditoria                       |
| `criado_em`           | timestamptz  | default `now()`                                                          |

Categorias por área: `cafe` → `adubacao, colheita, poda, defensivo, mao_de_obra, venda,
outro` · `propriedade` → `manutencao, combustivel, energia, agua, insumo, mao_de_obra,
venda, outro` · `outro` → `mao_de_obra, venda, outro`.

Tabela `lancamentos_pessoais` (`financas_pessoais`):

| Campo                | Tipo         | Observação                                                              |
|-----------------------|--------------|--------------------------------------------------------------------------|
| `id`                  | integer      | identity, autoincrement                                                  |
| `data`                | date         | volta do cliente Supabase como string `YYYY-MM-DD`                       |
| `tipo`                | text         | `despesa \| receita` — CHECK constraint                                  |
| `categoria`           | text         | depende do tipo — CHECK constraint espelha `CATEGORIAS_POR_TIPO` em `src/projects/financas-pessoais/db.ts` |
| `valor`               | numeric      | not null                                                                 |
| `descricao`           | text         | nullable                                                                 |
| `forma_pagamento`     | text         | nullable — `pix \| dinheiro \| cartao_credito \| cartao_debito`          |
| `mensagem_original`   | text         | texto bruto enviado pela pessoa, para auditoria                         |
| `criado_em`           | timestamptz  | default `now()`                                                          |

Categorias por tipo: `despesa` → `moradia, alimentacao, transporte, saude, assinaturas,
lazer, cartao_fatura, outro` · `receita` → `salario, extra, outro`.

Tabela `ai_usage` (compartilhada entre os dois projetos, não por projeto): `id, provider,
modelo, tokens_input, tokens_output, custo_estimado (nullable), criado_em` — usada pelo
comando "uso de ia" (ver seção própria acima).

Os `CHECK constraints` de área/tipo + categoria em cada tabela replicam exatamente as
regras acima — uma combinação inválida é rejeitada pelo próprio banco, não só pelo
código.

> `numeric` do Postgres volta do PostgREST como string (evita perda de precisão) — cada
> `db.ts` converte os campos numéricos de volta para `number` logo ao ler, então o resto
> do código (`tools.ts`, `reports.ts`, `pdf.ts` de cada projeto) nunca lida com isso
> diretamente.
>
> O schema e as migrations vivem no Supabase (aplicadas via MCP), não criadas pelo
> próprio bot no boot — `src/db.ts` só se conecta e cuida do que é compartilhado
> (`ai_usage`). Migrado de um SQLite local (`data/gestao.db`) em 21/08/2026; o arquivo
> antigo não é mais usado nem lido pelo bot, mas nada nele foi apagado. Separado em
> projetos (`gestao_rural` + `financas_pessoais`) em 21/08/2026.

## Estrutura de pastas

```
src/
  ai/
    types.ts               # interface AIProvider comum e tipos compartilhados
    gemini-provider.ts      # implementação via @google/genai
    claude-provider.ts      # implementação via @anthropic-ai/sdk
    router.ts               # AIRouter: escolhe o provider e faz fallback — nome da
                             #   ferramenta de registrar/pdf vem por parâmetro (varia
                             #   por projeto), lógica de roteamento em si não muda
  projects/
    types.ts                # Projeto ("gestao_rural" | "financas_pessoais"), ProjetoDef
                             #   (a interface que cada projeto implementa)
    registry.ts              # PROJETOS: Record<Projeto, ProjetoDef>
    gestao-rural/
      db.ts                  # Area/Categoria/CATEGORIAS_POR_AREA + CRUD sobre `entries`
      cotacao.ts               # cotação do café no mercado externo (scraping, cache 15 min)
      tools.ts                  # ferramentas de IA e o despachante que as executa
      prompt.ts                  # SYSTEM_PROMPT + validação do que a IA extraiu (Zod)
      reports.ts                  # relatório mensal em texto, agrupado por área
      pdf.ts                       # relatório mensal em PDF, agrupado por área
      index.ts                      # monta o ProjetoDef deste projeto
    financas-pessoais/
      db.ts, tools.ts, prompt.ts, reports.ts, pdf.ts, index.ts   # mesmo padrão acima,
                                                                  #   sobre `lancamentos_pessoais`
  db.ts        # cliente Supabase compartilhado + "uso de ia" (`ai_usage`, não é por
               #   projeto) — schema/migrations vivem no Supabase, não aqui
  pdf-shared.ts # primitivos de PDF compartilhados (cabeçalho, cartão, rodapé, paginação)
  format.ts    # formatação compartilhada (datas, moeda, quantidade) — usado pelos
               #   dois projetos
  parser.ts    # interpretarMensagem(texto, projeto, ...): monta prompt/ferramentas do
               #   projeto ativo e delega ao AIRouter (registrar, consultar, gerar PDF
               #   ou conversar) — não sabe qual projeto é, só recebe um ProjetoDef
  audio.ts     # transcrição de áudio via Gemini (entende OGG/Opus nativamente)
  whatsapp.ts  # conexão Baileys (QR, filtro de remetente, áudio, envio/recebimento)
  reports.ts   # só o relatório de "uso de ia" (compartilhado entre projetos)
  index.ts     # orquestração: permissões por projeto, troca de contexto, fluxo de
               #   confirmação/exclusão/comandos especiais operando sobre o projeto ativo
auth_info/     # sessão do WhatsApp (gerada automaticamente, git-ignored)
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

- Isolamento é por **projeto**, não por pessoa — todo mundo liberado pra `gestao_rural`
  vê e registra na mesma base desse projeto (a separação por `area`/`local` organiza os
  relatórios, mas não isola produtores diferentes dentro do mesmo projeto); o mesmo vale
  pra `financas_pessoais` se um dia mais de um número for liberado nele.
- Confirmação pendente, exclusão pendente, projeto ativo e memória de acompanhamento de
  perguntas ficam em memória (`Map`); reiniciar o bot descarta qualquer confirmação,
  exclusão ou pergunta em aberto, e volta todo mundo pro projeto padrão (`gestao_rural`).
- Sem controle de estoque — não há como responder "quantas sacas ainda tenho".
- Tem exclusão de registros (lista numerada, ver seção "Excluir registro"), mas ainda
  sem edição direta de um registro já salvo — a única forma de corrigir um erro é
  excluir e registrar de novo. Sem exportação em Excel, sem memória persistente da
  propriedade (talhões, hectares) — fases seguintes.
- Tem métricas de uso/custo (comando "uso de ia"), mas ainda sem limite de orçamento
  mensal configurável nem qualquer ação automática (ex: priorizar Gemini) perto de um
  limite — é só visibilidade por enquanto.
- Fallback entre Gemini e Claude é "tenta uma vez o outro"; sem retry com backoff
  exponencial nem tratamento fino de rate limit.
- Sem testes automatizados — é um protótipo para validar o conceito, não uma versão de
  produção.
