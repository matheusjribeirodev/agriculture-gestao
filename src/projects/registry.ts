import type { Projeto, ProjetoDef } from "./types";
import { gestaoRural } from "./gestao-rural";
import { financasPessoais } from "./financas-pessoais";

export const PROJETOS: Record<Projeto, ProjetoDef> = {
  gestao_rural: gestaoRural,
  financas_pessoais: financasPessoais,
};
