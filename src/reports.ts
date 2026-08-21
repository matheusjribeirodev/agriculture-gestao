import { consultarUsoIA } from "./db";
import { NOMES_MES, obterIntervaloMes, formatarDolar, formatarNumero } from "./format";

async function gerarTextoUsoIA(offsetMeses: number): Promise<string> {
  const { inicio, fim, ano, mes } = obterIntervaloMes(offsetMeses);
  const resumos = await consultarUsoIA({ inicio, fim });
  const nomeMes = NOMES_MES[mes - 1];

  if (resumos.length === 0) {
    return `Nenhum uso de IA registrado em ${nomeMes}/${ano}.`;
  }

  const linhas: string[] = [`📊 Uso de IA — ${nomeMes}/${ano}`, ""];

  // Uma mensagem do produtor pode gerar mais de uma chamada de IA (o
  // roteador pode encadear rodadas de ferramentas antes de responder).
  const totalChamadas = resumos.reduce((soma, r) => soma + r.chamadas, 0);
  linhas.push(`Chamadas de IA: ${totalChamadas}`, "");

  let custoTotal = 0;
  let custoIndisponivel = false;

  for (const resumo of resumos) {
    const nomeProvider = resumo.provider === "gemini" ? "Gemini" : "Claude";
    linhas.push(`${nomeProvider}:`);
    linhas.push(`${resumo.chamadas} chamada(s), ${formatarNumero(resumo.tokensInput + resumo.tokensOutput)} tokens`);
    if (resumo.custoEstimado !== null) {
      custoTotal += resumo.custoEstimado;
      linhas.push(`Custo estimado: ${formatarDolar(resumo.custoEstimado)}`);
    } else {
      custoIndisponivel = true;
    }
    linhas.push("");
  }

  if (custoIndisponivel) {
    linhas.push(
      "⚠️ Custo estimado incompleto — falta configurar o preço de algum provider no .env (ver README).",
    );
  } else {
    linhas.push(`Custo estimado total: ${formatarDolar(custoTotal)}`);
  }

  return linhas.join("\n").trimEnd();
}

export function gerarRelatorioUsoIAMesAtual(): Promise<string> {
  return gerarTextoUsoIA(0);
}

export function gerarRelatorioUsoIAMesPassado(): Promise<string> {
  return gerarTextoUsoIA(-1);
}
