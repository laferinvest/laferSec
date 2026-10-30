import { createContext, useContext } from "react";

export const CedenteSettingsContext = createContext(null);

export function useCedenteSettings() {
  const settings = useContext(CedenteSettingsContext);
  if (!settings) throw new Error("As configurações privadas ainda não foram carregadas.");
  return settings;
}
