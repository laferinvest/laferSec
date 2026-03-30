import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-goog-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NullableString = string | null;

type PartyLite = {
  role_on_document: NullableString;
  evidence_section: NullableString;
  nome: NullableString;
  cnpj_cpf: NullableString;
};

type Counterparty = {
  role_on_document: NullableString;
  evidence_section: NullableString;
  nome: NullableString;
  cnpj_cpf: NullableString;
  lgr: NullableString;
  nro: NullableString;
  bairro: NullableString;
  mun: NullableString;
  uf: NullableString;
  cep: NullableString;
};

type Duplicata = {
  nDup: string;
  dVenc: string;
  vDup: string;
};

type GeminiSemanticResult = {
  document_type: NullableString;
  numero_nfe: NullableString;
  data_emissao: NullableString;

  issuer: PartyLite;
  counterparty: Counterparty;

  v_nf_total: NullableString;
  duplicatas: Duplicata[];
  datas_fatura?: string[];

  chave_acesso: NullableString;
  codigo_acesso: NullableString;
  codigo_verificacao: NullableString;
  access_code_best: NullableString;
};

type FinalLegacyResult = {
  document_type: NullableString;
  numero_nfe: NullableString;
  data_emissao: NullableString;

  emit_nome: NullableString;
  emit_cnpj: NullableString;

  dest_nome: NullableString;
  dest_cnpj_cpf: NullableString;
  dest_lgr: NullableString;
  dest_nro: NullableString;
  dest_bairro: NullableString;
  dest_mun: NullableString;
  dest_uf: NullableString;
  dest_cep: NullableString;

  v_nf_total: NullableString;

  duplicatas: Duplicata[];

  endereco_limpo: NullableString;
  counterparty_endereco_limpo: NullableString;

  issuer_role_on_document: NullableString;
  issuer_evidence_section: NullableString;
  counterparty_role_on_document: NullableString;
  counterparty_evidence_section: NullableString;

  chave_acesso: NullableString;
  codigo_acesso: NullableString;
  codigo_verificacao: NullableString;
  access_code_best: NullableString;
};

type ValidationResult = {
  critical: string[];
  warnings: string[];
};

function asString(value: unknown): NullableString {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function onlyDigits(value: NullableString): NullableString {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  return digits || null;
}

function safeUpper(value: NullableString): string {
  return (value ?? "").toUpperCase();
}

function normalizeDocumentType(value: NullableString): NullableString {
  if (!value) return null;
  const upper = value.trim().toUpperCase();

  if (["NFE", "NF-E", "DANFE"].includes(upper)) return "NFE";
  if (["NFSE", "NFS-E", "DANFSE", "DANFS-E"].includes(upper)) return "NFSE";
  if (["CTE", "CT-E", "DACTE"].includes(upper)) return "CTE";
  if (["MDFE", "MDF-E", "MDFE"].includes(upper)) return "MDFE";
  if (upper === "UNKNOWN") return "UNKNOWN";

  return upper;
}

function normalizeNumberLike(value: NullableString): NullableString {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes("/")) {
    const parts = trimmed.split("/").map((part) => {
      const clean = part.replace(/[^\d]/g, "");
      if (!clean) return "";
      return String(Number(clean));
    });

    const hasAny = parts.some(Boolean);
    return hasAny ? parts.join("/") : null;
  }

  const clean = trimmed.replace(/[^\d]/g, "");
  if (!clean) return null;
  return String(Number(clean));
}

function normalizeMoney(value: NullableString): NullableString {
  if (!value) return null;
  let s = value.trim();
  if (!s) return null;

  s = s.replace(/\s+/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const num = Number(s);
  if (Number.isNaN(num)) return null;
  return num.toFixed(2);
}

function normalizeISODateOnly(value: NullableString): NullableString {
  if (!value) return null;
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (match) return match[1];

  return null;
}

function normalizeDateTime(value: NullableString): NullableString {
  if (!value) return null;
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00-03:00`;
  }

  return null;
}

function normalizeAccessCode(value: NullableString): NullableString {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const compact = trimmed
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();

  return compact || null;
}

function composeEnderecoLimpo(
  lgr: NullableString,
  nro: NullableString,
  bairro: NullableString,
  mun: NullableString,
  uf: NullableString,
): NullableString {
  const parts = [lgr, nro, bairro, mun, uf, "Brasil"]
    .map((p) => asString(p))
    .filter(Boolean) as string[];

  if (!parts.length) return null;
  return parts.join(", ");
}

function addOneYear(dateTimeStr: NullableString): string | null {
  if (!dateTimeStr) return null;

  const datePart = dateTimeStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  const [year, month, day] = datePart.split("-").map(Number);
  const dt = new Date(Date.UTC(year + 1, month - 1, day));
  return dt.toISOString().slice(0, 10);
}

function isFutureDate(dateISO: string, emissionDateTime: NullableString): boolean {
  const emissionDate = normalizeISODateOnly(emissionDateTime);
  if (!emissionDate) return false;
  return dateISO > emissionDate;
}

function splitTotalAcrossDates(totalStr: string, dates: string[]): Duplicata[] {
  const totalCents = Math.round(Number(totalStr) * 100);
  const count = dates.length;

  if (!count || Number.isNaN(totalCents)) {
    return [];
  }

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - (base * count);

  return dates.map((d, index) => {
    const cents = base + (index === count - 1 ? remainder : 0);
    return {
      nDup: String(index + 1),
      dVenc: d,
      vDup: (cents / 100).toFixed(2),
    };
  });
}

function defaultIssuer(): PartyLite {
  return {
    role_on_document: null,
    evidence_section: null,
    nome: null,
    cnpj_cpf: null,
  };
}

function defaultCounterparty(): Counterparty {
  return {
    role_on_document: null,
    evidence_section: null,
    nome: null,
    cnpj_cpf: null,
    lgr: null,
    nro: null,
    bairro: null,
    mun: null,
    uf: null,
    cep: null,
  };
}

function normalizeIssuer(raw: any): PartyLite {
  const party = raw ?? {};
  return {
    role_on_document: asString(party.role_on_document),
    evidence_section: asString(party.evidence_section),
    nome: asString(party.nome),
    cnpj_cpf: onlyDigits(asString(party.cnpj_cpf)),
  };
}

function normalizeCounterparty(raw: any): Counterparty {
  const party = raw ?? {};
  return {
    role_on_document: asString(party.role_on_document),
    evidence_section: asString(party.evidence_section),
    nome: asString(party.nome),
    cnpj_cpf: onlyDigits(asString(party.cnpj_cpf)),
    lgr: asString(party.lgr),
    nro: asString(party.nro),
    bairro: asString(party.bairro),
    mun: asString(party.mun),
    uf: asString(party.uf)?.toUpperCase() ?? null,
    cep: onlyDigits(asString(party.cep)),
  };
}

function normalizeDatasFatura(
  rawDates: any,
  dataEmissao: NullableString,
): string[] {
  const arr = Array.isArray(rawDates) ? rawDates : [];

  const cleaned = arr
    .map((d) => normalizeISODateOnly(asString(d)))
    .filter((d): d is string => Boolean(d))
    .filter((d) => isFutureDate(d, dataEmissao));

  return Array.from(new Set(cleaned)).sort();
}

function normalizeDuplicatas(
  duplicatas: any,
  dataEmissao: NullableString,
  totalNota: NullableString,
  datasFatura: string[],
): Duplicata[] {
  const fallbackDate = addOneYear(dataEmissao) ?? "2099-12-31";
  const fallbackValue = totalNota ?? "0.00";

  const arr = Array.isArray(duplicatas) ? duplicatas : [];

  const normalizedExplicit = arr
    .map((item, index) => {
      const nDup = normalizeNumberLike(asString(item?.nDup)) ?? String(index + 1);
      const dVenc = normalizeISODateOnly(asString(item?.dVenc));
      const vDup = normalizeMoney(asString(item?.vDup));

      return { nDup, dVenc, vDup };
    })
    .filter((d) => Boolean(d.nDup && d.dVenc && d.vDup)) as Duplicata[];

  if (normalizedExplicit.length > 0) {
    return normalizedExplicit;
  }

  if (datasFatura.length > 0 && totalNota) {
    const split = splitTotalAcrossDates(totalNota, datasFatura);
    if (split.length > 0) return split;
  }

  return [
    {
      nDup: "1",
      dVenc: fallbackDate,
      vDup: fallbackValue,
    },
  ];
}

function extractAndNormalizeAccessCodes(raw: any) {
  const chaveAcesso = normalizeAccessCode(
    asString(raw?.chave_acesso) ??
      asString(raw?.chave_de_acesso) ??
      asString(raw?.chave) ??
      asString(raw?.access_key)
  );

  const codigoAcesso = normalizeAccessCode(
    asString(raw?.codigo_acesso) ??
      asString(raw?.cod_acesso) ??
      asString(raw?.código_de_acesso) ??
      asString(raw?.código_acesso)
  );

  const codigoVerificacao = normalizeAccessCode(
    asString(raw?.codigo_verificacao) ??
      asString(raw?.cod_verificacao) ??
      asString(raw?.código_de_verificação) ??
      asString(raw?.código_verificação) ??
      asString(raw?.verification_code)
  );

  const accessCodeBest = chaveAcesso ?? codigoAcesso ?? codigoVerificacao ?? null;

  return {
    chave_acesso: chaveAcesso ?? accessCodeBest,
    codigo_acesso: codigoAcesso ?? accessCodeBest,
    codigo_verificacao: codigoVerificacao ?? accessCodeBest,
    access_code_best: accessCodeBest,
  };
}

function normalizeSemanticResult(raw: any): GeminiSemanticResult {
  const document_type = normalizeDocumentType(asString(raw?.document_type));
  const data_emissao = normalizeDateTime(asString(raw?.data_emissao));
  const v_nf_total = normalizeMoney(asString(raw?.v_nf_total));
  const datas_fatura = normalizeDatasFatura(raw?.datas_fatura, data_emissao);
  const accessCodes = extractAndNormalizeAccessCodes(raw);

  return {
    document_type,
    numero_nfe: normalizeNumberLike(asString(raw?.numero_nfe)),
    data_emissao,

    issuer: normalizeIssuer(raw?.issuer),
    counterparty: normalizeCounterparty(raw?.counterparty),

    v_nf_total,

    duplicatas: normalizeDuplicatas(
      raw?.duplicatas,
      data_emissao,
      v_nf_total,
      datas_fatura,
    ),

    datas_fatura,

    chave_acesso: accessCodes.chave_acesso,
    codigo_acesso: accessCodes.codigo_acesso,
    codigo_verificacao: accessCodes.codigo_verificacao,
    access_code_best: accessCodes.access_code_best,
  };
}

function mapToLegacyFields(parsed: GeminiSemanticResult): FinalLegacyResult {
  const issuer = parsed.issuer ?? defaultIssuer();
  const counterparty = parsed.counterparty ?? defaultCounterparty();

  const counterparty_endereco_limpo = composeEnderecoLimpo(
    counterparty.lgr,
    counterparty.nro,
    counterparty.bairro,
    counterparty.mun,
    counterparty.uf,
  );

  return {
    document_type: parsed.document_type,
    numero_nfe: parsed.numero_nfe,
    data_emissao: parsed.data_emissao,

    emit_nome: issuer.nome,
    emit_cnpj: issuer.cnpj_cpf,

    dest_nome: counterparty.nome,
    dest_cnpj_cpf: counterparty.cnpj_cpf,
    dest_lgr: counterparty.lgr,
    dest_nro: counterparty.nro,
    dest_bairro: counterparty.bairro,
    dest_mun: counterparty.mun,
    dest_uf: counterparty.uf,
    dest_cep: counterparty.cep,

    v_nf_total: parsed.v_nf_total,

    duplicatas: parsed.duplicatas,

    endereco_limpo: counterparty_endereco_limpo,
    counterparty_endereco_limpo,

    issuer_role_on_document: issuer.role_on_document,
    issuer_evidence_section: issuer.evidence_section,
    counterparty_role_on_document: counterparty.role_on_document,
    counterparty_evidence_section: counterparty.evidence_section,

    chave_acesso: parsed.chave_acesso,
    codigo_acesso: parsed.codigo_acesso,
    codigo_verificacao: parsed.codigo_verificacao,
    access_code_best: parsed.access_code_best,
  };
}

function validateSemanticResult(parsed: GeminiSemanticResult): ValidationResult {
  const critical: string[] = [];
  const warnings: string[] = [];

  const docType = parsed.document_type;
  const issuerSection = safeUpper(parsed.issuer?.evidence_section);
  const cpSection = safeUpper(parsed.counterparty?.evidence_section);
  const issuerRole = safeUpper(parsed.issuer?.role_on_document);
  const cpRole = safeUpper(parsed.counterparty?.role_on_document);

  if (!parsed.document_type) {
    warnings.push("document_type ausente.");
  }

  if (!parsed.issuer?.nome) {
    critical.push("Issuer sem nome.");
  }

  if (!parsed.counterparty?.nome) {
    critical.push("Counterparty sem nome.");
  }

  if (!parsed.v_nf_total) {
    critical.push("v_nf_total ausente.");
  }

  if (!parsed.data_emissao) {
    warnings.push("data_emissao ausente.");
  }

  if (!parsed.issuer?.cnpj_cpf) {
    warnings.push("Issuer sem CNPJ/CPF.");
  }

  if (!parsed.counterparty?.cnpj_cpf) {
    warnings.push("Counterparty sem CNPJ/CPF.");
  }

  if (!parsed.counterparty?.mun || !parsed.counterparty?.uf) {
    warnings.push("Counterparty com endereço incompleto para geocoding.");
  }

  if (!parsed.access_code_best) {
    warnings.push("Nenhuma chave/código de acesso/verificação foi extraído.");
  }

  if (docType === "NFSE") {
    const issuerLooksOk =
      issuerSection.includes("EMITENTE") ||
      issuerSection.includes("PRESTADOR") ||
      issuerRole.includes("PRESTADOR") ||
      issuerRole.includes("EMITENTE");

    const cpLooksOk =
      cpSection.includes("TOMADOR") ||
      cpRole.includes("TOMADOR");

    if (!issuerLooksOk) {
      critical.push("NFSE: issuer não parece vir do bloco de prestador/emissão.");
    }

    if (!cpLooksOk) {
      critical.push("NFSE: counterparty não parece vir do bloco TOMADOR DO SERVIÇO.");
    }
  }

  if (docType === "NFE") {
    const cpLooksOk =
      cpSection.includes("DESTINAT") ||
      cpRole.includes("DESTINAT") ||
      cpSection.includes("RECEBED") ||
      cpRole.includes("RECEBED");

    if (!cpLooksOk && parsed.counterparty?.nome) {
      critical.push("NFE: counterparty não parece vir do bloco destinatário/recebedor.");
    }
  }

  if (
    parsed.issuer?.cnpj_cpf &&
    parsed.counterparty?.cnpj_cpf &&
    parsed.issuer.cnpj_cpf === parsed.counterparty.cnpj_cpf
  ) {
    critical.push("Issuer e counterparty vieram com o mesmo CNPJ/CPF.");
  }

  const hasBadDuplicata = parsed.duplicatas.some(
    (d) => !d.nDup || !d.dVenc || !d.vDup,
  );

  if (hasBadDuplicata) {
    critical.push("Há duplicatas incompletas após normalização.");
  }

  if (parsed.duplicatas.length === 0) {
    critical.push("Nenhuma duplicata foi gerada.");
  }

  return { critical, warnings };
}

async function geocodeAddress(
  address: NullableString,
): Promise<{ lat: number | null; lng: number | null }> {
  if (!address) return { lat: null, lng: null };

  const googleKey = Deno.env.get("GOOGLE_MAPS_KEY");
  if (!googleKey) return { lat: null, lng: null };

  const geoUrl =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;

  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) {
    return { lat: null, lng: null };
  }

  const geoData = await geoRes.json();

  if (geoData?.results?.length > 0) {
    return {
      lat: geoData.results[0]?.geometry?.location?.lat ?? null,
      lng: geoData.results[0]?.geometry?.location?.lng ?? null,
    };
  }

  return { lat: null, lng: null };
}

function buildPrompt(retryReason?: string) {
  const correctionBlock = retryReason
    ? `
CORREÇÃO OBRIGATÓRIA:
A tentativa anterior teve estes erros:
${retryReason}
Reextraia sem repetir esses erros.
`
    : "";

  return `
Analise o PDF fiscal e retorne APENAS JSON válido.

${correctionBlock}

Classifique:
- NFE
- NFSE
- CTE
- MDFE
- UNKNOWN

Papéis:
- issuer = quem emite / vende / presta
- counterparty = quem compra / toma o serviço / recebe economicamente

Regras:
- Não confunda issuer com counterparty.
- NFSE: issuer = prestador/emissor; counterparty = tomador.
- NFE: issuer = emitente; counterparty = destinatário/recebedor principal.
- O endereço da counterparty deve vir apenas do bloco dela.
- Se houver ambiguidade, retorne null.
- Remova pontuação de CNPJ/CPF/CEP.
- numero_nfe sem pontos e sem zeros à esquerda.
- data_emissao em YYYY-MM-DDTHH:mm:ss-03:00; se só houver data, use T00:00:00-03:00.
- v_nf_total = valor total final da nota/documento.
- Extraia também, quando existir, identificadores de acesso/validação da nota.
- Procure expressões equivalentes como:
  - "Cód. de Acesso"
  - "Código de Acesso"
  - "Cod. de Acesso"
  - "Código de Verificação"
  - "Cod. Verificação"
  - "Chave de Acesso"
  - "Chave"
  - "Código"
- "chave_acesso" deve ser usado quando o documento indicar explicitamente "chave" ou "chave de acesso".
- "codigo_acesso" deve ser usado quando o documento indicar explicitamente "código de acesso" ou variação equivalente.
- "codigo_verificacao" deve ser usado quando o documento indicar explicitamente "código de verificação" ou variação equivalente.
- Se só houver uma variante clara no documento, preencha apenas a variante correspondente; não invente as outras.
- duplicatas:
  - use parcelas explícitas se existirem;
  - se não existirem, mas houver datas futuras em informações complementares/adicionais, use essas datas como vencimentos;
  - nesse caso, se só houver datas e não houver valores por parcela, apenas liste as datas em "datas_fatura";
  - não invente valores individuais quando o documento não trouxer;
  - se não houver datas claras, deixe "datas_fatura" vazio e "duplicatas" vazio.
- Só trate como vencimento datas futuras em relação à data_emissao.

Saída:
{
  "document_type": "string | null",
  "numero_nfe": "string | null",
  "data_emissao": "string | null",
  "issuer": {
    "role_on_document": "string | null",
    "evidence_section": "string | null",
    "nome": "string | null",
    "cnpj_cpf": "string | null"
  },
  "counterparty": {
    "role_on_document": "string | null",
    "evidence_section": "string | null",
    "nome": "string | null",
    "cnpj_cpf": "string | null",
    "lgr": "string | null",
    "nro": "string | null",
    "bairro": "string | null",
    "mun": "string | null",
    "uf": "string | null",
    "cep": "string | null"
  },
  "v_nf_total": "string | null",
  "chave_acesso": "string | null",
  "codigo_acesso": "string | null",
  "codigo_verificacao": "string | null",
  "datas_fatura": ["YYYY-MM-DD"],
  "duplicatas": [
    {
      "nDup": "string",
      "dVenc": "string",
      "vDup": "string"
    }
  ]
}
`.trim();
}

function buildResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      document_type: { type: "STRING" },
      numero_nfe: { type: "STRING" },
      data_emissao: { type: "STRING" },

      issuer: {
        type: "OBJECT",
        properties: {
          role_on_document: { type: "STRING" },
          evidence_section: { type: "STRING" },
          nome: { type: "STRING" },
          cnpj_cpf: { type: "STRING" },
        },
        required: ["nome", "role_on_document", "evidence_section"],
      },

      counterparty: {
        type: "OBJECT",
        properties: {
          role_on_document: { type: "STRING" },
          evidence_section: { type: "STRING" },
          nome: { type: "STRING" },
          cnpj_cpf: { type: "STRING" },
          lgr: { type: "STRING" },
          nro: { type: "STRING" },
          bairro: { type: "STRING" },
          mun: { type: "STRING" },
          uf: { type: "STRING" },
          cep: { type: "STRING" },
        },
        required: ["nome", "role_on_document", "evidence_section"],
      },

      v_nf_total: { type: "STRING" },

      chave_acesso: { type: "STRING" },
      codigo_acesso: { type: "STRING" },
      codigo_verificacao: { type: "STRING" },

      datas_fatura: {
        type: "ARRAY",
        items: { type: "STRING" },
      },

      duplicatas: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            nDup: { type: "STRING" },
            dVenc: { type: "STRING" },
            vDup: { type: "STRING" },
          },
          required: ["nDup", "dVenc", "vDup"],
        },
      },
    },
    required: [
      "document_type",
      "issuer",
      "counterparty",
      "v_nf_total",
      "datas_fatura",
      "duplicatas",
    ],
  };
}

async function callGeminiExtraction(
  pdfBase64: string,
  retryReason?: string,
): Promise<GeminiSemanticResult> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    throw new Error("GEMINI_API_KEY não configurada.");
  }

  const modelName = Deno.env.get("GEMINI_MODEL") || "gemini-3.1-flash-lite-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: buildPrompt(retryReason),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(),
    },
  };

  const geminiRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await geminiRes.json().catch(() => null);

  if (!geminiRes.ok) {
    const msg =
      data?.error?.message ||
      `Erro na API do Gemini. Status ${geminiRes.status}.`;
    throw new Error(msg);
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Gemini não retornou conteúdo JSON.");
  }

  let parsedRaw: any;
  try {
    parsedRaw = JSON.parse(rawText);
  } catch {
    throw new Error("O Gemini retornou JSON inválido.");
  }

  return normalizeSemanticResult(parsedRaw);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método não permitido." }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 405,
      },
    );
  }

  try {
    const body = await req.json();
    const pdfBase64 = asString(body?.pdfBase64);

    if (!pdfBase64) {
      throw new Error("Nenhum arquivo PDF enviado.");
    }

    let semanticResult = await callGeminiExtraction(pdfBase64);
    let validation = validateSemanticResult(semanticResult);

    if (validation.critical.length > 0) {
      semanticResult = await callGeminiExtraction(
        pdfBase64,
        validation.critical.join(" | "),
      );
      validation = validateSemanticResult(semanticResult);
    }

    const resultadoJson = mapToLegacyFields(semanticResult);

    if (validation.critical.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Não foi possível extrair a NF com segurança.",
          extraction_errors: validation.critical,
          extraction_warnings: validation.warnings,
          partial_data: resultadoJson,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 422,
        },
      );
    }

    const { lat, lng } = await geocodeAddress(
      resultadoJson.counterparty_endereco_limpo,
    );

    return new Response(
      JSON.stringify({
        ...resultadoJson,
        lat,
        lng,
        extraction_warnings: validation.warnings,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Erro desconhecido.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      },
    );
  }
});