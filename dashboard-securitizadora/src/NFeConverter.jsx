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
          <vOrig>${num(d.v_nf)}</vOrig>
          <vDesc>0.00</vDesc>
          <vLiq>${num(d.v_nf)}</vLiq>
        </fat>
        ${dupsXml}
      </cobr>
      <pag>
        <detPag>
          <indPag>1</indPag>
          <tPag>99</tPag>
          <xPag></xPag>
          <vPag>0.00</vPag>
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
      <nProt>${soNum(d.protocolo)}</nProt>
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
        title={
          disabled
            ? "Extensão Lafer Invest não detectada"
            : enabled
              ? "Clique para desativar"
              : "Clique para ativar"
        }
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

  const [configAberta, setConfigAberta] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState("");

  const [mostrarMaps, setMostrarMaps] = useState(true);
  const [downloadXml, setDownloadXml] = useState(true);
  const [pesquisarCenprot, setPesquisarCenprot] = useState(true);
  const [prefsCarregadas, setPrefsCarregadas] = useState(false);

  const [extensaoLaferInstalada, setExtensaoLaferInstalada] = useState(false);
  const [checandoExtensao, setChecandoExtensao] = useState(true);

  async function verificarExtensaoLafer() {
    return new Promise((resolve) => {
      let respondeu = false;

      function onMessage(event) {
        if (event.data?.type === "LAFER_EXTENSION_PONG") {
          if (respondeu) return;
          respondeu = true;
          clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          resolve(true);
        }
      }

      const timeout = setTimeout(() => {
        if (!respondeu) {
          respondeu = true;
          window.removeEventListener("message", onMessage);
          resolve(false);
        }
      }, 1500);

      window.addEventListener("message", onMessage);

      window.postMessage(
        {
          type: "LAFER_EXTENSION_PING",
        },
        "*"
      );
    });
  }

  useEffect(() => {
    async function carregarPrefsEExtensao() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setPrefsCarregadas(true);
          setChecandoExtensao(false);
          return;
        }

        const { data, error } = await supabase
          .from("user_preferences")
          .select("mostrar_maps, download_xml, pesquisar_cenprot")
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
          setPesquisarCenprot(
            data.pesquisar_cenprot === null ||
              data.pesquisar_cenprot === undefined
              ? true
              : data.pesquisar_cenprot
          );
        }

        const instalada = await verificarExtensaoLafer();
        setExtensaoLaferInstalada(instalada);

        if (!instalada) {
          setPesquisarCenprot(false);

          await supabase
            .from("user_preferences")
            .upsert(
              { user_id: user.id, pesquisar_cenprot: false },
              { onConflict: "user_id" }
            );
        }
      } catch (err) {
        console.error("Erro ao carregar prefs/extensão:", err);
        setExtensaoLaferInstalada(false);
        setPesquisarCenprot(false);
      } finally {
        setPrefsCarregadas(true);
        setChecandoExtensao(false);
      }
    }

    carregarPrefsEExtensao();
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
    if (campo === "pesquisar_cenprot" && !extensaoLaferInstalada) {
      setPesquisarCenprot(false);
      setPrefsMsg(
        "⚠️ Para usar o CENPROT, instale a extensão Lafer Invest."
      );
      setTimeout(() => setPrefsMsg(""), 3500);
      return;
    }

    setter(valor);
    salvarToggle(campo, valor);
  }

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === "LAFER_RESULTADO_PROTESTO") {
        const res = event.data.resultado;
        const resCnpjLimpo = (res.cnpj || "").replace(/\D/g, "");

        setResultados((prev) =>
          prev.map((r) => {
            const rCnpjLimpo = (r.cnpj || "").replace(/\D/g, "");
            if (rCnpjLimpo === resCnpjLimpo && rCnpjLimpo !== "") {
              return { ...r, protesto: res };
            }
            return r;
          })
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const processar = async () => {
    if (files.length === 0) {
      setStatus("❌ Selecione ao menos um arquivo PDF.");
      return;
    }

    setLoading(true);
    setStatus("");
    setProgress("");
    setResultados([]);

    const novosResultados = [];
    const cnpjsParaConsultar = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`Processando ${i + 1} / ${files.length}: ${file.name}...`);

      try {
        const base64Pdf = await fileToBase64(file);

        const { data, error } = await supabase.functions.invoke("processar-nfe", {
          body: { pdfBase64: base64Pdf },
        });

        if (error) throw new Error(error.message);
        if (data.error) throw new Error(data.error);

        const xmlString = gerarXmlCompleto(data);

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
          protesto: null,
        });

        if (data.dest_cnpj_cpf) {
          cnpjsParaConsultar.push(data.dest_cnpj_cpf.replace(/\D/g, ""));
        }
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

    if (
      pesquisarCenprot &&
      extensaoLaferInstalada &&
      cnpjsParaConsultar.length > 0
    ) {
      window.postMessage(
        {
          type: "LAFER_CONSULTA_PROTESTO",
          cnpjs: cnpjsParaConsultar,
        },
        "*"
      );
    }

    const erros = novosResultados.filter((r) => !r.ok).length;

    const sufixoCenprot =
      pesquisarCenprot && extensaoLaferInstalada
        ? " Iniciando consulta de protestos..."
        : pesquisarCenprot && !extensaoLaferInstalada
          ? " Consulta de protestos indisponível: instale a extensão Lafer Invest."
          : "";

    setStatus(
      erros === 0
        ? `✅ ${files.length} arquivo(s) processado(s)!${sufixoCenprot}`
        : `⚠️ ${files.length - erros} sucesso(s), ${erros} erro(s).`
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
        Consulta no CENPROT, Visão no Maps e Conversão para XML
      </h2>

      <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "20px" }}>
        Selecione uma ou mais DANFEs em PDF. Os dados do sacado serão extraídos
        via IA e a extensão fará o download do XML da NFe, uma consulta
        automática de protestos no Cenprot e dará a visão no Google Maps se o
        endereço estiver correto.
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
            Clique em <strong>Extrair Dados e Consultar</strong>
          </li>
          <li>
            A IA processa o documento, faz o download do XML, busca a fachada no
            Google Maps e a extensão Lafer Invest pesquisa os protestos na hora!
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
            setFiles(Array.from(e.target.files));
            setStatus("");
            setResultados([]);
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
        {loading ? "Processando IA..." : "Extrair Dados e Consultar"}
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

                  <Toggle
                    label="Pesquisar no CENPROT"
                    descricao={
                      checandoExtensao
                        ? "Verificando se a extensão Lafer Invest está instalada..."
                        : extensaoLaferInstalada
                          ? "Aciona a extensão Lafer para consulta de protestos automaticamente"
                          : "Extensão Lafer Invest não detectada. Instale a extensão para habilitar esta função."
                    }
                    enabled={pesquisarCenprot && extensaoLaferInstalada}
                    onChange={(val) =>
                      handleToggle(
                        "pesquisar_cenprot",
                        setPesquisarCenprot,
                        val
                      )
                    }
                    saving={savingPrefs}
                    disabled={checandoExtensao || !extensaoLaferInstalada}
                  />
                </>
              )}

              {!checandoExtensao && !extensaoLaferInstalada && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px",
                    borderRadius: "8px",
                    background: "#fff7ed",
                    border: "1px solid #fdba74",
                    color: "#9a3412",
                    fontSize: "12px",
                    lineHeight: "1.5",
                  }}
                >
                  <strong>Extensão Lafer Invest não encontrada.</strong>
                  <div style={{ marginTop: "4px" }}>
                    Para habilitar a pesquisa automática no CENPROT, instale e
                    ative a extensão no navegador.
                  </div>
                </div>
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
            const hasProtest =
              r.protesto && r.protesto.status === "PROTESTADO";
            const isRed = !r.ok || hasProtest;

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

                    <div
                      style={{
                        marginTop: "4px",
                        padding: "10px",
                        background: "#fff",
                        borderRadius: "6px",
                        border: "1px dashed #cbd5e1",
                      }}
                    >
                      <strong>Cenprot (Protestos): </strong>

                      {!extensaoLaferInstalada ? (
                        <span
                          style={{ color: "#94a3b8", fontWeight: "bold" }}
                        >
                          — Extensão Lafer Invest não instalada
                        </span>
                      ) : !pesquisarCenprot ? (
                        <span
                          style={{ color: "#94a3b8", fontWeight: "bold" }}
                        >
                          — Consulta desativada
                        </span>
                      ) : !r.protesto ? (
                        <span
                          style={{ color: "#d97706", fontWeight: "bold" }}
                        >
                          ⏳ Pesquisando em segundo plano...
                        </span>
                      ) : r.protesto.status === "LIMPO" ? (
                        <span
                          style={{ color: "#059669", fontWeight: "bold" }}
                        >
                          ✅ LIMPO (0 títulos)
                        </span>
                      ) : r.protesto.status === "PROTESTADO" ? (
                        <span
                          style={{ color: "#dc2626", fontWeight: "bold" }}
                        >
                          ⚠️ PROTESTADO ({r.protesto.totalTitulos} títulos em
                          cartórios)
                        </span>
                      ) : (
                        <span
                          style={{ color: "#991b1b", fontWeight: "bold" }}
                        >
                          ❓ Falha na consulta
                        </span>
                      )}
                    </div>
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