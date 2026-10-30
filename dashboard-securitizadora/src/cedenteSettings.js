export async function loadCedenteSettings(client, signal) {
  let query = client.from("cedente_private_settings").select("hidden_aliases").eq("id", "visibility");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.single();
  if (error) throw new Error("Não foi possível carregar as configurações privadas do painel.");
  if (!Array.isArray(data?.hidden_aliases) || data.hidden_aliases.some((alias) => typeof alias !== "string" || !alias.trim())) {
    throw new Error("As configurações privadas do painel estão inválidas.");
  }
  const hiddenAliases = [...new Set(data.hidden_aliases.map((alias) => alias.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))];
  if (hiddenAliases.some((alias) => !alias)) throw new Error("As configurações privadas do painel estão inválidas.");
  return { hiddenAliases };
}
