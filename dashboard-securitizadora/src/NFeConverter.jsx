import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

// =============================================================================
// UTILITÁRIOS
// =============================================================================

function baixarXML(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo.replace(".pdf", ".xml");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function gerarXmlCompleto(d) {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const num = (v) => (v ? String(v).replace(",", ".") : "0.00");
  const soNum = (v) => String(v ?? "").replace(/\D/g, "");

  const docDest =
    soNum(d.dest_cnpj_cpf).length === 11
      ? `<CPF>${soNum(d.dest_cnpj_cpf)}</CPF>`
      : `<CNPJ>${soNum(d.dest_cnpj_cpf)}</CNPJ>`;

  const cUF = d.chave_acesso ? d.chave_acesso.substring(0, 2) : "31";
  const cNF = d.chave_acesso ? d.chave_acesso.substring(35, 43) : "00000000";
  const cDV = d.chave_acesso ? d.chave_acesso.slice(-1) : "0";

  const temDuplicatas = Array.isArray(d.duplicatas) && d.duplicatas.length > 0;

  const nProtFinal =
    soNum(d.nProt || d.n_prot || d.protocolo) || "123456789123456";

  const tPagFinal = temDuplicatas
    ? "14"
    : soNum(d.tPag || d.t_pag) || "99";

  const vPagFinal = num(
    d.vPag || d.v_pag || d.vNF || d.v_nf || d.v_nf_total
  );

  const vOrigFinal = num(
    d.vOrig || d.v_orig || d.vNF || d.v_nf || d.v_nf_total
  );

  const vLiqFinal = num(
    d.vLiq || d.v_liq || d.vNF || d.v_nf || d.v_nf_total
  );

  const xPagXml = tPagFinal === "99" ? `<xPag>Outros</xPag>` : "";

  const dupsXml = (d.duplicatas || [])
    .map(
      (dup) => `
        <dup>
          <nDup>${esc(dup.nDup)}</nDup>
          <dVenc>${esc(dup.dVenc)}</dVenc>
          <vDup>${num(dup.vDup)}</vDup>
        </dup>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${soNum(d.chave_acesso)}" versao="4.00">
      <ide>
        <cUF>${cUF}</cUF>
        <cNF>${cNF}</cNF>
        <natOp>${esc(d.natureza_operacao)}</natOp>
        <mod>55</mod>
        <serie>${esc(d.serie_nfe)}</serie>
        <nNF>${esc(d.numero_nfe)}</nNF>
        <dhEmi>${esc(d.data_emissao)}</dhEmi>
        <dhSaiEnt>${esc(d.data_saida)}</dhSaiEnt>
        <tpNF>1</tpNF>
        <idDest>1</idDest>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>${cDV}</cDV>
        <tpAmb>1</tpAmb>
        <finNFe>1</finNFe>
        <indFinal>1</indFinal>
        <indPres>9</indPres>
        <procEmi>0</procEmi>
        <verProc>4.00</verProc>
      </ide>
      <emit>
        <CNPJ>${soNum(d.emit_cnpj)}</CNPJ>
        <xNome>${esc(d.emit_nome)}</xNome>
        <enderEmit>
          <xLgr>${esc(d.emit_lgr)}</xLgr>
          <nro>${esc(d.emit_nro) || "S/N"}</nro>
          <xBairro>${esc(d.emit_bairro)}</xBairro>
          <cMun></cMun>
          <xMun>${esc(d.emit_mun)}</xMun>
          <UF>${esc(d.emit_uf)}</UF>
          <CEP>${soNum(d.emit_cep)}</CEP>
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>
          <fone></fone>
        </enderEmit>
        <IE>${soNum(d.emit_ie)}</IE>
      </emit>
      <dest>
        ${docDest}
        <xNome>${esc(d.dest_nome)}</xNome>
        <enderDest>
          <xLgr>${esc(d.dest_lgr)}</xLgr>
          <nro>${esc(d.dest_nro) || "S/N"}</nro>
          <xBairro>${esc(d.dest_bairro)}</xBairro>
          <cMun></cMun>
          <xMun>${esc(d.dest_mun)}</xMun>
          <UF>${esc(d.dest_uf)}</UF>
          <CEP>${soNum(d.dest_cep)}</CEP>
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>
          <fone></fone>
        </enderDest>
        <indIEDest>1</indIEDest>
        <IE>${soNum(d.dest_ie)}</IE>
      </dest>
      <total>
        <ICMSTot>
          <vBC>${num(d.v_bc)}</vBC>
          <vICMS>${num(d.v_icms)}</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>${num(d.v_prod)}</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vII>0.00</vII>
          <vIPI>0.00</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>0.00</vPIS>
          <vCOFINS>0.00</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>${num(d.v_nf)}</vNF>
          <vTotTrib>${num(d.v_tot_trib)}</vTotTrib>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>0</modFrete>
      </transp>
      <cobr>
        <fat>
          <nFat>${esc(d.numero_nfe)}</nFat>
          <vOrig>${vOrigFinal}</vOrig>
          <vDesc>0.00</vDesc>
          <vLiq>${vLiqFinal}</vLiq>
        </fat>
        ${dupsXml}
      </cobr>
      <pag>
        <detPag>
          <indPag>1</indPag>
          <tPag>${tPagFinal}</tPag>
          ${xPagXml}
          <vPag>${vPagFinal}</vPag>
        </detPag>
      </pag>
    </infNFe>
  </NFe>
  <protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
    <infProt>
      <tpAmb>1</tpAmb>
      <verAplic>NFe_4.00</verAplic>
      <chNFe>${soNum(d.chave_acesso)}</chNFe>
      <dhRecbto>${esc(d.data_emissao)}</dhRecbto>
      <nProt>${nProtFinal}</nProt>
      <digVal></digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
}

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseMoney(value) {
  if (value === undefined || value === null) return null;

  let s = String(value).trim();
  if (!s) return null;

  s = s.replace(/R\$/gi, "").replace(/\s+/g, "");

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
  }

  s = s.replace(/[^0-9.-]/g, "");

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function formatCurrencyBRL(value) {
  const num = parseMoney(value);

  if (num === null) {
    return "R$ [valor]";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

function formatDateBRShort(value) {
  if (!value) return "[vencimento]";

  const text = String(value).trim();
  const iso = text.slice(0, 10);
  const isoMatch = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year.slice(-2)}`;
  }

  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);

  if (brMatch) {
    const [, day, month, year] = brMatch;
    return `${day}/${month}/${year.slice(-2)}`;
  }

  return text;
}

function formatCount(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.match(/\d+/)?.[0];

  if (!digits) {
    return "[quantidade]";
  }

  return String(Number(digits));
}

function pluralProduto(qtdFormatada) {
  return qtdFormatada === "1" ? "produto distinto" : "produtos distintos";
}

function montarEmailConfirmacao(d) {
  const sacado = d.dest_nome || "[NOME DO SACADO]";
  const cedente = d.emit_nome || "[NOME DO CEDENTE]";
  const numeroNfe = d.numero_nfe || "[NÚMERO DA NF]";
  const qtdItens = formatCount(
    d.qtd_itens_distintos ??
      d.quantidade_itens_distintos ??
      d.itens_distintos_count
  );
  const totalNota = formatCurrencyBRL(
    d.v_nf_total || d.vNF || d.v_nf || d.vProd || d.v_prod
  );

  const duplicatas =
    Array.isArray(d.duplicatas) && d.duplicatas.length > 0
      ? d.duplicatas
      : [
          {
            nDup: "1",
            dVenc: null,
            vDup: d.v_nf_total || d.vNF || d.v_nf || d.vPag || d.v_pag,
          },
        ];

  const linhasTabelaHtml = duplicatas
    .map((dup, index) => {
      const parcela = escapeHtml(dup.nDup || String(index + 1));
      const vencimento = escapeHtml(formatDateBRShort(dup.dVenc));
      const valor = escapeHtml(formatCurrencyBRL(dup.vDup));

      return `
        <tr>
          <td style="border:1px solid #d9d9d9;padding:8px 10px;text-align:center;">${parcela}</td>
          <td style="border:1px solid #d9d9d9;padding:8px 10px;text-align:center;">${vencimento}</td>
          <td style="border:1px solid #d9d9d9;padding:8px 10px;text-align:right;">${valor}</td>
        </tr>`;
    })
    .join("");

  const linhasTabelaPlain = duplicatas
    .map((dup, index) => {
      const parcela = dup.nDup || String(index + 1);
      const vencimento = formatDateBRShort(dup.dVenc);
      const valor = formatCurrencyBRL(dup.vDup);
      return `${parcela}\t${vencimento}\t${valor}`;
    })
    .join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.55;">
      <p>À ${escapeHtml(sacado)},<br />A/C de [RESPONSÁVEL].</p>

      <p>Meu nome é Daniel Ferreira, trabalho na Lafer Invest Securitizadora S/A, empresa parceira da ${escapeHtml(cedente)}.</p>

      <p>Nós negociamos com eles a NF de número ${escapeHtml(numeroNfe)}:</p>

      <p>Venda de ${escapeHtml(qtdItens)} ${escapeHtml(pluralProduto(qtdItens))}, totalizando ${escapeHtml(totalNota)}, dividido conforme segue a fatura abaixo:</p>

      <table style="border-collapse:collapse;width:100%;max-width:560px;margin:8px 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
        <thead>
          <tr>
            <th style="border:1px solid #d9d9d9;background:#f3f4f6;padding:8px 10px;text-align:center;">Parcela</th>
            <th style="border:1px solid #d9d9d9;background:#f3f4f6;padding:8px 10px;text-align:center;">Vencimento</th>
            <th style="border:1px solid #d9d9d9;background:#f3f4f6;padding:8px 10px;text-align:right;">Valor</th>
          </tr>
        </thead>
        <tbody>${linhasTabelaHtml}
        </tbody>
      </table>

      <p>Pode me confirmar se a mercadoria foi entregue em <strong>perfeita e boa ordem, dentro do prazo e das condições estabelecidas</strong>, incluindo valores e vencimentos?</p>

      <p>Caso positivo, peço, por gentileza, que retorne o email afirmando que foi entregue em perfeita e boa ordem, dentro do prazo e condições estabelecidas.</p>

      <p>Att,</p>
    </div>
  `.trim();

  const plainText = `À ${sacado},
A/C de [RESPONSÁVEL].

Meu nome é Daniel Ferreira, trabalho na Lafer Invest Securitizadora S/A, empresa parceira da ${cedente}.

Nós negociamos com eles a NF de número ${numeroNfe}:

Venda de ${qtdItens} ${pluralProduto(qtdItens)}, totalizando ${totalNota}, dividido conforme segue a fatura abaixo:

Parcela	Vencimento	Valor
${linhasTabelaPlain}

Pode me confirmar se a mercadoria foi entregue em perfeita e boa ordem, dentro do prazo e das condições estabelecidas, incluindo valores e vencimentos?

Caso positivo, peço, por gentileza, que retorne o email afirmando que foi entregue em perfeita e boa ordem, dentro do prazo e condições estabelecidas.

Att,`;

  return { html, plainText };
}

function montarTextoBoletos(d) {
  const sacado = d.dest_nome || "[NOME DO SACADO]";
  const cedente = d.emit_nome || "[NOME DO CEDENTE]";
  const duplicatas =
    Array.isArray(d.duplicatas) && d.duplicatas.length > 0
      ? d.duplicatas
      : [
          {
            nDup: "1",
            dVenc: null,
            vDup: d.v_nf_total || d.vNF || d.v_nf || d.vPag || d.v_pag,
          },
        ];
  const fraseBoletos =
    duplicatas.length === 1
      ? "Segue em anexo o boleto para pagamento. <strong>Poderia me confirmar, por favor, o recebimento do mesmo?</strong>"
      : "Seguem em anexo os boletos para pagamento. <strong>Poderia me confirmar, por favor, o recebimento dos mesmos?</strong>";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.55;">
      <p>À ${escapeHtml(sacado)},<br />A/C de _______;</p>

      <p>A Lafer Invest Securitizadora S/A vem confirmar por meio desta a cessão (antecipação) das duplicatas elencadas no e-mail anterior.</p>

      <p>${fraseBoletos}</p>

      <p>A omissão de resposta, ou respostas como “ok”, “sim” e similares, implicará em consentimento e responsabilidade quanto ao teor desta notificação.</p>

      <p>Ressaltamos ainda que a cessão foi realizada conforme rito previsto na Lei 10406/02, Art. 286 a 298, assim sendo, <strong>o pagamento das duplicatas supra descritas devem ser realizadas somente a Lafer Invest Securitizadora S/A</strong> e não mais a ${escapeHtml(cedente)}. Qualquer dúvida, por favor entre em contato com a Lafer Invest através desse e-mail ou do nosso telefone.</p>

      <p>Também em conformidade com a Lei 13775/18, Art. 10: “São nulas de pleno direito as cláusulas contratuais que vedam, limitam ou oneram, de forma direta ou indireta, a emissão ou a circulação de duplicatas [...]”.</p>

      <p>Att,</p>
    </div>
  `.trim();

  const plainText = `À ${sacado},
A/C de _______;

A Lafer Invest Securitizadora S/A vem confirmar por meio desta a cessão (antecipação) das duplicatas elencadas no e-mail anterior.

${fraseBoletos}

A omissão de resposta, ou respostas como “ok”, “sim” e similares, implicará em consentimento e responsabilidade quanto ao teor desta notificação.

Ressaltamos ainda que a cessão foi realizada conforme rito previsto na Lei 10406/02, Art. 286 a 298, assim sendo, o pagamento das duplicatas supra descritas devem ser realizadas somente a Lafer Invest Securitizadora S/A e não mais a ${cedente}.

Também em conformidade com a Lei 13775/18, Art. 10: “São nulas de pleno direito as cláusulas contratuais que vedam, limitam ou oneram, de forma direta ou indireta, a emissão ou a circulação de duplicatas [...]”.

Att,`;

  return { html, plainText };
}

async function copiarEmailConfirmacao(emailConfirmacao) {
  if (!emailConfirmacao) return;

  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([
      new window.ClipboardItem({
        "text/html": new Blob([emailConfirmacao.html], {
          type: "text/html",
        }),
        "text/plain": new Blob([emailConfirmacao.plainText], {
          type: "text/plain",
        }),
      }),
    ]);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(emailConfirmacao.plainText);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = emailConfirmacao.plainText;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

// =============================================================================
// SUBCOMPONENTE: TOGGLE
// =============================================================================

function Toggle({
  label,
  descricao,
  enabled,
  onChange,
  saving,
  disabled = false,
}) {
  const bloqueado = saving || disabled;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 0",
        borderBottom: "1px solid #f1f5f9",
        opacity: bloqueado ? 0.7 : 1,
      }}
    >
      <div style={{ flex: 1, marginRight: "16px" }}>
        <div
          style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}
        >
          {label}
        </div>
        <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
          {descricao}
        </div>
      </div>

      <button
        onClick={() => !bloqueado && onChange(!enabled)}
        disabled={bloqueado}
        style={{
          position: "relative",
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          border: "none",
          cursor: bloqueado ? "not-allowed" : "pointer",
          background: enabled ? "#4f46e5" : "#cbd5e1",
          transition: "background 0.2s",
          flexShrink: 0,
          opacity: bloqueado ? 0.6 : 1,
        }}
        title={enabled ? "Clique para desativar" : "Clique para ativar"}
      >
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: enabled ? "23px" : "3px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
    </div>
  );
}

// =============================================================================
// CHAVE DA API MAPS
// =============================================================================

const MAPS_API_KEY = import.meta.env.VITE_MAPS_API_KEY;

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    const existing = document.querySelector('script[data-google-maps="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps));
      existing.addEventListener("error", reject);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";

    script.onload = () => resolve(window.google.maps);
    script.onerror = reject;

    document.head.appendChild(script);
  });
}

function StreetView({ lat, lng, label, endereco }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let panorama = null;
    let map = null;

    async function init() {
      if (
        lat == null ||
        lng == null ||
        !containerRef.current ||
        !mapRef.current
      ) {
        return;
      }

      try {
        setErro("");
        const maps = await loadGoogleMaps(MAPS_API_KEY);

        const point = { lat: Number(lat), lng: Number(lng) };

        const streetViewService = new maps.StreetViewService();

        streetViewService.getPanorama(
          {
            location: point,
            radius: 80,
            preference: maps.StreetViewPreference.NEAREST,
            sources: [maps.StreetViewSource.OUTDOOR],
          },
          (result, status) => {
            const data = result?.data ?? result;

            console.log("SV STATUS:", status);
            console.log("INPUT POINT:", point);
            console.log("SV DATA:", data);

            if (status !== maps.StreetViewStatus.OK || !data?.location?.pano) {
              setErro("Street View não encontrado para este endereço.");
              return;
            }

            panorama = new maps.StreetViewPanorama(containerRef.current, {
              pano: data.location.pano,
              pov: {
                heading: data.tiles?.centerHeading ?? 0,
                pitch: 0,
              },
              zoom: 1,
              addressControl: true,
              linksControl: true,
              panControl: true,
              fullscreenControl: true,
              showRoadLabels: true,
            });

            panorama.addListener("pano_changed", () => {
              console.log("PANO ATUAL:", panorama.getPano());
            });

            panorama.addListener("position_changed", () => {
              console.log(
                "POSIÇÃO ATUAL:",
                panorama.getPosition()?.toJSON?.()
              );
            });
          }
        );

        map = new maps.Map(mapRef.current, {
          center: point,
          zoom: 19,
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          mapTypeId: "hybrid",
        });

        new maps.Marker({
          map,
          position: point,
          title: label,
        });

        const geocoder = new maps.Geocoder();
        geocoder.geocode({ address: endereco }, (results, status) => {
          console.log("GEOCODER STATUS:", status);
          console.log("GEOCODER RESULTS:", results);
        });
      } catch (e) {
        console.error(e);
        setErro("Erro ao carregar Google Maps.");
      }
    }

    init();
  }, [lat, lng, label, endereco]);

  if (lat == null || lng == null) {
    return (
      <div
        style={{
          marginTop: "12px",
          marginBottom: "8px",
          height: "300px",
          borderRadius: "8px",
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          fontSize: "13px",
          border: "1px solid #e2e8f0",
        }}
      >
        📍 Coordenadas não disponíveis
      </div>
    );
  }

  return (
    <div style={{ marginTop: "12px", marginBottom: "8px" }}>
      {erro ? (
        <div
          style={{
            height: "520px",
            borderRadius: "8px",
            background: "#fef2f2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#991b1b",
            fontSize: "13px",
            border: "1px solid #fecaca",
            padding: "16px",
            textAlign: "center",
            marginBottom: "12px",
          }}
        >
          {erro}
        </div>
      ) : (
        <div
          ref={containerRef}
          title={`Street View de ${label}`}
          style={{
            width: "100%",
            height: "520px",
            borderRadius: "8px",
            marginBottom: "12px",
          }}
        />
      )}

      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: "320px",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
        }}
      />
    </div>
  );
}

// =============================================================================
// COMPONENTE PRINCIPAL
// =============================================================================

export default function NFeConverter() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState("");
  const [resultados, setResultados] = useState([]);
  const [copyMsg, setCopyMsg] = useState("");

  const [configAberta, setConfigAberta] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState("");

  const [mostrarMaps, setMostrarMaps] = useState(true);
  const [downloadXml, setDownloadXml] = useState(true);
  const [prefsCarregadas, setPrefsCarregadas] = useState(false);


  useEffect(() => {
    async function carregarPrefs() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setPrefsCarregadas(true);
          return;
        }

        const { data, error } = await supabase
          .from("user_preferences")
          .select("mostrar_maps, download_xml")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!error && data) {
          setMostrarMaps(
            data.mostrar_maps === null || data.mostrar_maps === undefined
              ? true
              : data.mostrar_maps
          );
          setDownloadXml(
            data.download_xml === null || data.download_xml === undefined
              ? true
              : data.download_xml
          );
        }
      } catch (err) {
        console.error("Erro ao carregar preferências:", err);
      } finally {
        setPrefsCarregadas(true);
      }
    }

    carregarPrefs();
  }, []);

  async function salvarToggle(campo, valor) {
    setSavingPrefs(true);
    setPrefsMsg("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSavingPrefs(false);
      return;
    }

    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: user.id, [campo]: valor }, { onConflict: "user_id" });

    setSavingPrefs(false);

    if (error) {
      setPrefsMsg("❌ Erro ao salvar preferência.");
    } else {
      setPrefsMsg("✔ Salvo");
      setTimeout(() => setPrefsMsg(""), 2000);
    }
  }

  function handleToggle(campo, setter, valor) {
    setter(valor);
    salvarToggle(campo, valor);
  }

  const processar = async (arquivosSelecionados = files) => {
    if (arquivosSelecionados.length === 0) {
      setStatus("❌ Selecione ao menos um arquivo PDF.");
      return;
    }

    setLoading(true);
    setStatus("");
    setProgress("");
    setResultados([]);
    setCopyMsg("");

    const novosResultados = [];

    for (let i = 0; i < arquivosSelecionados.length; i++) {
      const file = arquivosSelecionados[i];
      setProgress(`Processando ${i + 1} / ${files.length}: ${file.name}...`);

      try {
        const base64Pdf = await fileToBase64(file);

        const { data, error } = await supabase.functions.invoke("processar-nfe", {
          body: { pdfBase64: base64Pdf },
        });
        
        if (error) throw new Error(error.message);
        if (data.error) throw new Error(data.error);

        const xmlString = gerarXmlCompleto(data);
        const emailConfirmacao = montarEmailConfirmacao(data);
        const textoBoletos = montarTextoBoletos(data);

        if (downloadXml) {
          baixarXML(xmlString, file.name);
        }

        novosResultados.push({
          nome: file.name,
          ok: true,
          estabelecimento: data.dest_nome || "Não identificado",
          cnpj: data.dest_cnpj_cpf || "Não identificado",
          endereco: data.endereco_limpo || "Não identificado",
          lat: data.lat,
          lng: data.lng,
          xmlFalso: xmlString,
          dadosNfe: data,
          emailConfirmacao,
          textoBoletos,
          cedente: data.emit_nome || "Não identificado",
          numeroNfe: data.numero_nfe || "Não identificado",
        });

      } catch (err) {
        novosResultados.push({
          nome: file.name,
          ok: false,
          msg: `❌ Erro: ${err.message}`,
        });
      }
    }

    setResultados(novosResultados);
    setProgress("");
    setLoading(false);

    const erros = novosResultados.filter((r) => !r.ok).length;

    setStatus(
      erros === 0
        ? `✅ ${arquivosSelecionados.length} arquivo(s) processado(s)!`
        : `⚠️ ${arquivosSelecionados.length - erros} sucesso(s), ${erros} erro(s).`
    );

    setFiles([]);
    const input = document.getElementById("nfe-converter-input");
    if (input) input.value = "";
  };

  const isDisabled = loading || files.length === 0;

  return (
    <div
      style={{
        background: "#fff",
        padding: "32px",
        borderRadius: "12px",
        boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
        width: "70%",
        maxWidth: "1400px",
        minWidth: "600px",
        margin: "0 auto",
        border: "1px solid #e5e7eb",
      }}
    >
      <h2 style={{ marginTop: 0, color: "#111827", fontSize: "20px" }}>
        Visão no Maps e Conversão para XML
      </h2>

      <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "20px" }}>
        Selecione uma ou mais DANFEs em PDF. Os dados do sacado serão extraídos
        via IA, o XML da NFe será gerado para download e a fachada será exibida
        no Google Maps quando o endereço estiver correto.
      </p>

      <div
        style={{
          background: "#f8fafc",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          marginBottom: "24px",
          fontSize: "13px",
          color: "#334155",
          lineHeight: "1.6",
        }}
      >
        <strong style={{ color: "#0f172a", fontSize: "14px" }}>
          📄 Como funciona:
        </strong>
        <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
          <li>Selecione os PDFs das notas</li>
          <li>
            Clique em <strong>Extrair Dados</strong>
          </li>
          <li>
            A IA processa o documento, gera o XML, monta o email padrão e busca a
            fachada no Google Maps quando houver coordenadas disponíveis.
          </li>
        </ol>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <input
          id="nfe-converter-input"
          type="file"
          multiple
          accept=".pdf"
          onChange={(e) => {
            const arquivosSelecionados = Array.from(e.target.files || []);

            setFiles(arquivosSelecionados);
            setStatus("");
            setResultados([]);
            setCopyMsg("");

            if (arquivosSelecionados.length > 0) {
              processar(arquivosSelecionados);
            }
          }}
          disabled={loading}
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: "12px",
            border: "2px dashed #cbd5e1",
            borderRadius: "8px",
            background: "#f8fafc",
            cursor: "pointer",
          }}
        />
        <div
          style={{
            fontSize: "13px",
            color: "#64748b",
            marginTop: "8px",
            fontWeight: "500",
          }}
        >
          {files.length} arquivo(s) selecionado(s).
        </div>
      </div>

      <button
        onClick={processar}
        disabled={isDisabled}
        style={{
          boxSizing: "border-box",
          width: "100%",
          padding: "12px",
          borderRadius: "8px",
          border: "none",
          background: isDisabled ? "#9ca3af" : "#4f46e5",
          color: "#fff",
          fontWeight: "600",
          fontSize: "15px",
          cursor: isDisabled ? "not-allowed" : "pointer",
          transition: "background 0.2s",
        }}
      >
        {loading ? "Processando IA..." : "Extrair Dados"}
      </button>

      <div
        style={{
          marginTop: "24px",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => setConfigAberta((prev) => !prev)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "#f8fafc",
            border: "none",
            cursor: "pointer",
            color: "#64748b",
            fontSize: "13px",
            fontWeight: "600",
          }}
        >
          <span>⚙️ Configurações</span>
          <span
            style={{
              display: "inline-block",
              transform: configAberta ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            ▼
          </span>
        </button>

        {configAberta && (
          <div style={{ padding: "16px", borderTop: "1px solid #e2e8f0" }}>
            <div style={{ paddingTop: "4px" }}>
              {!prefsCarregadas ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px",
                    color: "#94a3b8",
                    fontSize: "13px",
                  }}
                >
                  Carregando preferências...
                </div>
              ) : (
                <>
                  <Toggle
                    label="Mostrar no Maps"
                    descricao="Exibe a fachada do estabelecimento via Google Street View"
                    enabled={mostrarMaps}
                    onChange={(val) =>
                      handleToggle("mostrar_maps", setMostrarMaps, val)
                    }
                    saving={savingPrefs}
                  />

                  <Toggle
                    label="Download de .XML"
                    descricao="Faz o download do arquivo XML gerado a cada NF processada"
                    enabled={downloadXml}
                    onChange={(val) =>
                      handleToggle("download_xml", setDownloadXml, val)
                    }
                    saving={savingPrefs}
                  />
                </>
              )}

              {prefsMsg && (
                <div
                  style={{
                    marginTop: "10px",
                    fontSize: "12px",
                    textAlign: "right",
                    color: prefsMsg.includes("❌")
                      ? "#dc2626"
                      : prefsMsg.includes("⚠️")
                        ? "#d97706"
                        : "#059669",
                    fontWeight: "600",
                  }}
                >
                  {prefsMsg}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {resultados.some((r) => r.ok && (r.emailConfirmacao || r.textoBoletos)) && (
        <div
          style={{
            marginTop: "16px",
            borderRadius: "10px",
            border: "1px solid #c7d2fe",
            background: "#eef2ff",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid #c7d2fe",
              background: "#e0e7ff",
            }}
          >
            <div
              style={{
                fontSize: "15px",
                fontWeight: "700",
                color: "#312e81",
              }}
            >
              ✉️ Textos padrão de email
            </div>
            <div
              style={{
                marginTop: "4px",
                fontSize: "12px",
                color: "#4338ca",
                lineHeight: "1.45",
              }}
            >
              Use os botões de copiar para colar no Zoho/Gmail mantendo a
              formatação. Os campos “A/C” ficam como marcadores para você
              preencher o responsável.
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            {resultados.map((r, i) => {
              if (!r.ok || (!r.emailConfirmacao && !r.textoBoletos)) return null;

              const textos = [
                {
                  titulo: "Texto de Checagem",
                  conteudo: r.emailConfirmacao,
                  copyKey: `checagem-${i}`,
                  botao: "Copiar checagem",
                },
                {
                  titulo: "Texto para Boletos",
                  conteudo: r.textoBoletos,
                  copyKey: `boletos-${i}`,
                  botao: "Copiar boletos",
                },
              ].filter((item) => item.conteudo);

              return (
                <div
                  key={`email-${i}`}
                  style={{
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "12px",
                      borderBottom: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      fontSize: "12px",
                      color: "#475569",
                      lineHeight: "1.4",
                    }}
                  >
                    <strong style={{ color: "#0f172a" }}>{r.nome}</strong>
                    <br />
                    Cedente: {r.cedente} | NF: {r.numeroNfe}
                  </div>

                  <div
                    style={{
                      padding: "14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                    }}
                  >
                    {textos.map((item, textIndex) => (
                      <div
                        key={item.copyKey}
                        style={{
                          borderRadius: "8px",
                          border: "1px solid #e5e7eb",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "12px",
                            padding: "10px 12px",
                            borderBottom: "1px solid #e5e7eb",
                            background: textIndex === 0 ? "#f8fafc" : "#fefce8",
                          }}
                        >
                          <strong
                            style={{
                              color: textIndex === 0 ? "#0f172a" : "#713f12",
                              fontSize: "13px",
                            }}
                          >
                            {item.titulo}
                          </strong>

                          <button
                            onClick={async () => {
                              try {
                                await copiarEmailConfirmacao(item.conteudo);
                                setCopyMsg(item.copyKey);
                                setTimeout(() => setCopyMsg(""), 1800);
                              } catch (err) {
                                console.error(err);
                                setCopyMsg(`erro-${item.copyKey}`);
                                setTimeout(() => setCopyMsg(""), 2500);
                              }
                            }}
                            style={{
                              border: "none",
                              borderRadius: "7px",
                              background:
                                copyMsg === item.copyKey ? "#059669" : "#4f46e5",
                              color: "#fff",
                              padding: "8px 11px",
                              fontSize: "12px",
                              fontWeight: "700",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {copyMsg === item.copyKey
                              ? "Copiado!"
                              : copyMsg === `erro-${item.copyKey}`
                                ? "Erro ao copiar"
                                : item.botao}
                          </button>
                        </div>

                        <div
                          style={{
                            padding: "16px",
                            overflowX: "auto",
                          }}
                          dangerouslySetInnerHTML={{ __html: item.conteudo.html }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {progress && (
        <div
          style={{
            marginTop: "16px",
            fontSize: "14px",
            color: "#4f46e5",
            fontWeight: "600",
            textAlign: "center",
          }}
        >
          {progress}
        </div>
      )}

      {resultados.length > 0 && (
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {resultados.map((r, i) => {
            const isRed = !r.ok;

            return (
              <div
                key={i}
                style={{
                  padding: "16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                  background: isRed ? "#fef2f2" : "#ecfdf5",
                  color: isRed ? "#991b1b" : "#064e3b",
                  border: `1px solid ${isRed ? "#fecaca" : "#a7f3d0"}`,
                }}
              >
                <div
                  style={{
                    color: isRed ? "#991b1b" : "#6b7280",
                    marginBottom: "12px",
                    fontSize: "12px",
                    fontWeight: "600",
                  }}
                >
                  ARQUIVO: {r.nome}
                </div>

                {r.ok ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div>
                      <strong>Estabelecimento:</strong> {r.estabelecimento}
                    </div>
                    <div>
                      <strong>CNPJ/CPF:</strong> {r.cnpj}
                    </div>
                    <div>
                      <strong>Endereço:</strong> {r.endereco}
                    </div>

                    {mostrarMaps && r.lat && r.lng && (
                      <StreetView
                        lat={r.lat}
                        lng={r.lng}
                        label={r.estabelecimento}
                        endereco={r.endereco}
                      />
                    )}
                  </div>
                ) : (
                  <div style={{ fontWeight: "500" }}>{r.msg}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            borderRadius: "8px",
            background: status.includes("❌")
              ? "#fef2f2"
              : status.includes("⚠️")
                ? "#fffbeb"
                : "#ecfdf5",
            color: status.includes("❌")
              ? "#991b1b"
              : status.includes("⚠️")
                ? "#92400e"
                : "#065f46",
            fontWeight: "500",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}