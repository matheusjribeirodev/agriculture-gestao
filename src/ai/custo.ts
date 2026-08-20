// Preços por milhão de tokens, lidos do .env — nunca fixos no código, porque
// mudam com o tempo (ver seção "Custo de IA" do README). Sem preço
// configurado, não estimamos custo (retorna null em vez de chutar).
function lerPreco(prefixo: "GEMINI" | "CLAUDE"): { input: number; output: number } | null {
  const input = Number(process.env[`${prefixo}_INPUT_PRICE_PER_MILLION`]);
  const output = Number(process.env[`${prefixo}_OUTPUT_PRICE_PER_MILLION`]);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input <= 0 || output <= 0) return null;
  return { input, output };
}

export function estimarCusto(
  provider: "gemini" | "claude",
  tokensInput: number,
  tokensOutput: number,
): number | null {
  const preco = lerPreco(provider === "gemini" ? "GEMINI" : "CLAUDE");
  if (!preco) return null;
  return (tokensInput / 1_000_000) * preco.input + (tokensOutput / 1_000_000) * preco.output;
}
