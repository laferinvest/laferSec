// Rótulos e códigos do INICIAR_PROJETO_ARVORE_CEDENTES.md.
export const CATALOG_VERSION = "2026-09-28";

export const FAMILIES = [
  { code: "FAM-A", label: "Consumo e serviços às pessoas", color: "#7c3aed", description: "Alimentos, saúde, beleza, vestuário, lar, educação e lazer." },
  { code: "FAM-B", label: "Construção e mercado imobiliário", color: "#c06118", description: "Construção residencial, comercial, institucional, industrial e logística." },
  { code: "FAM-C", label: "Agropecuária e florestas", color: "#16805d", description: "Lavouras, pecuária e silvicultura." },
  { code: "FAM-D", label: "Recursos naturais e indústria de base", color: "#a64a61", description: "Mineração, petróleo, metais, química, celulose e materiais de base." },
  { code: "FAM-E", label: "Infraestrutura e utilidades", color: "#087d93", description: "Energia, saneamento, telecomunicações e infraestrutura de transporte." },
  { code: "FAM-F", label: "Mobilidade e logística", color: "#3465c5", description: "Veículos, transporte de cargas e passageiros, e armazenagem." },
  { code: "FAM-G", label: "Tecnologia e serviços às empresas", color: "#a16207", description: "TI, serviços profissionais e operação industrial sem destino posterior aberto." },
  { code: "FAM-Z", label: "Destino não identificado", color: "#64748b", description: "Ainda não há evidência para identificar a cadeia de destino." },
];

const sectorRows = [
  ["SET-A1", "Alimentos e bebidas"], ["SET-A2", "Saúde e cuidado"],
  ["SET-A3", "Bem-estar e beleza"], ["SET-A4", "Vestuário, calçados e esporte"],
  ["SET-A5", "Bens para o lar"], ["SET-A6", "Educação, turismo e lazer"],
  ["SET-B1", "Construção residencial"], ["SET-B2", "Construção comercial e institucional"],
  ["SET-B3", "Construção industrial e logística"], ["SET-C1", "Lavouras temporárias"],
  ["SET-C2", "Lavouras permanentes"], ["SET-C3", "Pecuária"], ["SET-C4", "Silvicultura"],
  ["SET-D1", "Mineração"], ["SET-D2", "Petróleo, gás e refino"],
  ["SET-D3", "Siderurgia e metais"], ["SET-D4", "Química de base e fertilizantes"],
  ["SET-D5", "Celulose, papel e materiais de base"], ["SET-E1", "Energia elétrica"],
  ["SET-E2", "Água, esgoto e resíduos"], ["SET-E3", "Redes de telecomunicações"],
  ["SET-E4", "Infraestrutura de transporte"], ["SET-F1", "Automóveis e veículos leves"],
  ["SET-F2", "Veículos produtivos"], ["SET-F3", "Transporte de cargas e armazenagem"],
  ["SET-F4", "Transporte de passageiros"], ["SET-G1", "Software, dados e TI"],
  ["SET-G2", "Serviços profissionais e terceirização"],
  ["SET-G3", "Operação industrial com destino posterior não aberto"],
  ["SET-Z1", "Destino não identificado"],
];
export const SECTORS = sectorRows.map(([code, label]) => ({ code, label, family: `FAM-${code[4]}` }));

export const PURPOSES = [
  { code: "FIN-K", label: "Investimento em ativos — CAPEX", description: "Aquisição, construção ou intervenção capitalizável em um ativo do usuário econômico." },
  { code: "FIN-I", label: "Insumo da produção corrente", description: "Item incorporado ao produto ou consumido para produzir, sem vínculo comprovado com investimento final." },
  { code: "FIN-M", label: "Manutenção e reposição rotineiras", description: "Reparo, desgaste ou manutenção periódica que mantém a operação funcionando." },
  { code: "FIN-S", label: "Serviço operacional", description: "Atividade corrente do comprador, como frete, suporte ou terceirização." },
  { code: "FIN-C", label: "Consumo final", description: "Consumo pelo usuário final, mesmo quando há varejista ou distribuidor intermediário." },
  { code: "FIN-U", label: "Finalidade não identificada", description: "Ainda não há evidência suficiente para identificar a finalidade." },
];
export const CAPEX_REASONS = [
  { code: "CAP-EXP", label: "CAPEX de expansão", description: "Aumento de capacidade, nova instalação ou ativo adicional." },
  { code: "CAP-PRE", label: "CAPEX de preservação", description: "Substituição ou intervenção relevante para preservar a capacidade existente." },
  { code: "CAP-EFI", label: "CAPEX de eficiência", description: "Modernização para produtividade, redução de custos ou melhoria de desempenho." },
  { code: "CAP-ADE", label: "CAPEX de adequação", description: "Atendimento a requisito técnico, de segurança ou ambiental." },
  { code: "CAP-MUL", label: "CAPEX com múltiplas finalidades", description: "Mais de um motivo comprovado, sem abertura para separar parcelas." },
  { code: "CAP-NI", label: "CAPEX com finalidade não identificada", description: "Investimento conhecido, mas sem comprovação de seu motivo específico." },
];
export const APPLICATIONS = [
  ["APL-OBR", "Obra ou estrutura"], ["APL-EQP", "Equipamento completo"],
  ["APL-COM", "Componente de equipamento novo"], ["APL-SUB", "Grande componente de substituição"],
  ["APL-REP", "Peça de reposição rotineira"], ["APL-EMB", "Embalagem"],
  ["APL-MAT", "Matéria-prima"], ["APL-CON", "Consumível de produção"],
  ["APL-PRO", "Produto final"], ["APL-SER", "Serviço"],
  ["APL-SOF", "Software ou outro ativo intelectual"], ["APL-BIO", "Ativo biológico cultivado"],
  ["APL-MUL", "Múltiplas aplicações sem abertura"], ["APL-OUT", "Outra aplicação comprovada"],
  ["APL-NI", "Aplicação não identificada"],
].map(([code, label]) => ({ code, label }));

export const CHANNELS = [
  ["CAN-USU", "Venda ao usuário"], ["CAN-EQP", "Venda a fabricante de equipamento"],
  ["CAN-IND", "Venda a outro fabricante"], ["CAN-DIS", "Venda a distribuidor"],
  ["CAN-VAR", "Venda a varejista"], ["CAN-INT", "Venda a integrador ou empreiteiro"],
  ["CAN-OUT", "Outro canal comprovado"], ["CAN-NI", "Canal não identificado"],
].map(([code, label]) => ({ code, label }));
export const MARKETS = [
  ["MER-BR", "Mercado interno"], ["MER-ED", "Exportação direta"],
  ["MER-EI", "Exportação indireta"], ["MER-MX", "Mercado misto sem abertura"],
  ["MER-NI", "Mercado não identificado"],
].map(([code, label]) => ({ code, label }));
export const ATTRIBUTES = [
  { key: "essentiality", label: "Essencialidade da compra", options: ["Essencial", "Adiável", "Mista sem abertura", "Não identificada"] },
  { key: "durability", label: "Durabilidade do bem de consumo", options: ["Durável", "Semidurável", "Não durável", "Não aplicável", "Não identificada"] },
  { key: "pricing", label: "Repasse de preços", options: ["Contratual", "Negociado", "Preço fixo no contrato", "Misto sem abertura", "Não identificado"] },
  { key: "payerType", label: "Natureza do pagador", options: ["Empresa privada", "Ente público", "Entidade sem fins lucrativos", "Pessoa física", "Não identificada"] },
  { key: "inventory", label: "Estado do estoque do canal", options: ["Reposição normal", "Formação de estoque", "Redução de estoque", "Não identificado"] },
];
export const QUALITIES = ["Documentada", "Declarada", "Inferida", "Não identificada"];
export const DIRECTIONS = ["Adversa", "Favorável", "Mista", "Não identificada"];
export const EFFECT_CHANNELS = ["Receita", "Custo", "Caixa", "Pagamento"];
export const FACTORS = [
  ["FAT-INV", "Investimento do comprador", "Pedido depende de projeto ou aquisição de ativo."],
  ["FAT-PRO", "Produção do comprador", "Pedido acompanha as unidades produzidas pelo comprador."],
  ["FAT-USO", "Uso da base instalada", "Compra depende de horas, desgaste ou manutenção."],
  ["FAT-REN", "Renda do consumidor", "Vendas finais dependem da renda disponível."],
  ["FAT-CRE", "Crédito do comprador", "Financiamento viabiliza a compra."],
  ["FAT-GIR", "Custo e acesso ao capital de giro", "Necessidade identificada de financiar o ciclo operacional."],
  ["FAT-SAF", "Safra e clima", "Cultura, região ou operação afetada identificadas."],
  ["FAT-COM", "Preço de commodity", "Commodity relevante para receita ou custo identificada."],
  ["FAT-MOE", "Câmbio", "Receita, custo ou dívida em moeda estrangeira identificados."],
  ["FAT-ENE", "Energia e combustível", "Participação relevante no custo ou na receita identificada."],
  ["FAT-IMP", "Concorrência importada", "Produto concorrente e mercado atingido identificados."],
  ["FAT-EST", "Estoques do canal", "Reposição ou movimento dos estoques altera os pedidos."],
  ["FAT-PUB", "Orçamento público", "Pagamento ou execução depende de orçamento público."],
  ["FAT-TER", "Pagamento de terceiros ao sacado", "Fonte de caixa comum e dependência identificadas."],
  ["FAT-SAZ", "Sazonalidade", "Calendário recorrente da demanda identificado."],
].map(([code, label, description]) => ({ code, label, description }));

export function labelFor(options, code, fallback = "Não informado") {
  return options.find((option) => option.code === code)?.label || fallback;
}

export function classificationPath(record) {
  const path = [];
  const append = (options, code, kind) => {
    const option = options.find((item) => item.code === code);
    if (option) path.push({ ...option, kind });
  };
  append(FAMILIES, record.family, "family");
  append(SECTORS, record.sector, "sector");
  if (record.purpose === "FIN-K" && record.capex) append(CAPEX_REASONS, record.capex, "purpose");
  else append(PURPOSES, record.purpose, "purpose");
  append(APPLICATIONS, record.application, "application");
  return path;
}

// Sugestões de acompanhamento: separadas dos rótulos e sem séries ou previsões.
export function indicatorsFor(record) {
  if (record.purpose === "FIN-K") return ["FBCF (contexto agregado)", "PIM de bens de capital pertinente", "Pedidos e projetos do usuário econômico"];
  if (record.purpose === "FIN-I") return ["Produção do setor de destino", "Pedidos e estoques do comprador"];
  if (record.purpose === "FIN-M") return ["Utilização da base instalada", "Calendário de manutenção do comprador"];
  if (record.purpose === "FIN-C") return ["Vendas ao consumidor no setor de destino", "Pedidos e estoques do canal"];
  if (record.purpose === "FIN-S") return ["Volume de atividade do comprador", "Renovações e execução dos contratos"];
  return ["Identificar a finalidade antes de escolher os indicadores"];
}
