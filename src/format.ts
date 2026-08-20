// O banco continua em YYYY-MM-DD (formato certo para ordenar/filtrar) — esta
// função é só para exibição ao produtor.
export function formatarDataBR(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}
