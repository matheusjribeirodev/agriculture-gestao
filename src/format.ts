// O banco continua em YYYY-MM-DD (formato certo para ordenar/filtrar) — esta
// função é só para exibição ao produtor.
export function formatarDataBR(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

export const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarDataLocal(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function obterIntervaloMes(offsetMeses: number): { inicio: string; fim: string; ano: number; mes: number } {
  const agora = new Date();
  let ano = agora.getFullYear();
  let mes = agora.getMonth() + 1 + offsetMeses;

  while (mes < 1) {
    mes += 12;
    ano -= 1;
  }
  while (mes > 12) {
    mes -= 12;
    ano += 1;
  }

  const ultimoDia = new Date(ano, mes, 0).getDate();

  return {
    inicio: formatarDataLocal(ano, mes, 1),
    fim: formatarDataLocal(ano, mes, ultimoDia),
    ano,
    mes,
  };
}

export function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Custo de IA é cobrado em dólar pela Anthropic/Google — nunca formatar como
// R$, mesmo que o resto do bot trabalhe em reais.
export function formatarDolar(valor: number): string {
  return valor.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function formatarQuantidade(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
