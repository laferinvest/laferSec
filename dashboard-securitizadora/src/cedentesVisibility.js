// Preferências carregadas do banco somente para usuários autorizados.
export function isCedenteNameVisible(hiddenAliases, ...names) {
  const normalizedNames = names.filter(Boolean).map((name) => String(name)
    .replace(/^\d+\s*-\s*/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  // Nomes em qualquer posição, inclusive após códigos/CNPJ, com palavras inteiras.
  return !normalizedNames.some((name) => hiddenAliases.some((alias) => ` ${name} `.includes(` ${alias} `)));
}
