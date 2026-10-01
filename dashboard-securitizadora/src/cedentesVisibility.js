// Lista compartilhada pelos seletores de inadimplência e de cadastro na árvore.
const HIDDEN_CEDENTES = [
  "shirlei", "atacado primus", "companhia uai", "emporio trovoada", "grid motors",
  "indumax", "inova", "jl", "j l", "kammer", "leleco", "m g", "mg", "marcenaria",
  "milk lat", "r10", "reges", "sl", "s l", "solucao comercio", "visual",
  "luis carlos leleco", "59 339", "atacado primu", "lafer invest",
];

// Preferência de exibição: não altera o cálculo nem os registros da carteira.
export function isCedenteNameVisible(...names) {
  const normalizedNames = names.filter(Boolean).map((name) => String(name)
    .replace(/^\d+\s*-\s*/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  // Nomes em qualquer posição, inclusive após códigos/CNPJ, com palavras inteiras.
  return !normalizedNames.some((name) => HIDDEN_CEDENTES.some((alias) => ` ${name} `.includes(` ${alias} `)));
}
