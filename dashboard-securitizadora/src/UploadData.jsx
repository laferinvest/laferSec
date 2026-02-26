import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import * as XLSX from "xlsx";

// ==========================================
// FUNÇÕES DE LIMPEZA
// ==========================================
const cleanNumber = (val) => {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  let s = String(val).trim().replace(/\s/g, "");
  if (s.split(",").length === 2 && s.split(".").length >= 2) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(",", ".");
  }
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
};

const cleanDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string" && val.includes("/")) {
    const parts = val.split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return val;
};

const limpaChave = (val) => {
  if (val === null || val === undefined) return "";
  let s = String(val).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s;
};

export default function UploadData() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState("");

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  };

  const processAllFiles = async () => {
    if (files.length === 0) {
      setStatus("❌ Por favor, selecione os arquivos primeiro.");
      return;
    }

    setLoading(true);
    setStatus("");
    setProgress("1/5: Lendo e classificando arquivos...");

    try {
      const ratesFiles = [];
      const mainFiles = [];

      // 1. CLASSIFICAÇÃO DOS ARQUIVOS (O "Detetive")
      for (let file of files) {
        const data = await readFileAsArrayBuffer(file);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawArray = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        let isRates = false;
        for (let r = 0; r < Math.min(rawArray.length, 50); r++) {
          const rowTxt = rawArray[r].map(x => String(x || "").trim().toLowerCase()).join(" ");
          if (rowTxt.includes("border") && (rowTxt.includes("vlr") || rowTxt.includes("face")) && (rowTxt.includes("des") || rowTxt.includes("deságio"))) {
            isRates = true;
            break;
          }
        }

        if (isRates) ratesFiles.push({ name: file.name, rawArray });
        else mainFiles.push({ name: file.name, worksheet });
      }

      console.log(`Arquivos de Taxas: ${ratesFiles.length} | Principais: ${mainFiles.length}`);
      setProgress("2/5: Extraindo mapa de taxas...");

      // 2. EXTRAÇÃO DE TAXAS
      let globalRatesMap = {};
      for (let rf of ratesFiles) {
        const raw = rf.rawArray;
        let hdrR = -1;

        for (let r = 0; r < raw.length; r++) {
          const rowTxt = raw[r].map(x => String(x || "").trim().toLowerCase()).join(" ");
          if (rowTxt.includes("border") && (rowTxt.includes("vlr") || rowTxt.includes("face")) && (rowTxt.includes("des") || rowTxt.includes("deságio"))) {
            hdrR = r; break;
          }
        }

        if (hdrR !== -1) {
          const hdr = raw[hdrR].map(x => String(x || "").trim().toLowerCase());
          const cBordero = hdr.findIndex(h => h.includes("border"));
          let cDes = hdr.findIndex(h => h.includes("deságio"));
          if (cDes === -1) cDes = hdr.findIndex(h => h.includes("des"));
          const cTxEfet = hdr.findIndex(h => h.includes("tx.efet"));

          if (cBordero !== -1 && cDes !== -1 && cTxEfet !== -1) {
            let lastSeenBordero = null;
            for (let r = hdrR + 1; r < raw.length; r++) {
              const rowVals = raw[r];
              let currentBNum = null;

              const bVal = parseFloat(String(rowVals[cBordero] || "").trim());
              if (!isNaN(bVal) && Number.isInteger(bVal) && bVal > 0) currentBNum = bVal;
              else {
                for (let v of rowVals) {
                  if (v === null) continue;
                  const vFloat = parseFloat(String(v).trim());
                  if (!isNaN(vFloat) && Number.isInteger(vFloat) && vFloat > 0) { currentBNum = vFloat; break; }
                }
              }

              if (currentBNum !== null) lastSeenBordero = currentBNum;
              const desVal = cleanNumber(rowVals[cDes]);
              const txVal = cleanNumber(rowVals[cTxEfet]);

              if (desVal === null && txVal === null) continue;
              if (lastSeenBordero !== null) {
                globalRatesMap[lastSeenBordero] = { Desagio: desVal, "Tx.Efet": txVal };
              }
            }
          }
        }
      }

      // ==========================================
      // MODO TAXA APENAS: só vieram arquivos de taxa
      // Busca todos os registros do banco com aquele Borderô e atualiza só Desagio e Tx.Efet
      // ==========================================
      if (mainFiles.length === 0 && Object.keys(globalRatesMap).length > 0) {
        const borderos = Object.keys(globalRatesMap).map(Number);
        setProgress(`3/5: Modo Taxa — buscando registros para ${borderos.length} borderô(s) no banco...`);

        const { data: existingRows, error: fetchErr } = await supabase
          .from("secInfo")
          .select('*')
          .in('"Borderô"', borderos);

        if (fetchErr) throw new Error(`Erro ao buscar registros no banco: ${fetchErr.message}`);
        if (!existingRows || existingRows.length === 0) {
          throw new Error("Nenhum registro encontrado no banco para os borderôs informados.");
        }

        setProgress(`4/5: Atualizando taxas em ${existingRows.length} registro(s)...`);

        // Monta os registros atualizados mantendo todos os campos e sobrescrevendo só as taxas
        const updatedRows = existingRows.map(row => ({
          ...row,
          Desagio: globalRatesMap[row["Borderô"]]?.Desagio ?? row.Desagio,
          "Tx.Efet": globalRatesMap[row["Borderô"]]?.["Tx.Efet"] ?? row["Tx.Efet"],
        }));

        const BATCH_SIZE = 500;
        let updatedCount = 0;
        for (let i = 0; i < updatedRows.length; i += BATCH_SIZE) {
          const batch = updatedRows.slice(i, i + BATCH_SIZE);
          const { error } = await supabase
            .from("secInfo")
            .upsert(batch, { onConflict: '"Cód.Red"' });
          if (error) throw new Error(`Erro ao atualizar taxas: ${error.message}`);
          updatedCount += batch.length;
          setProgress(`5/5: Atualizando... ${updatedCount} / ${updatedRows.length}`);
        }

        setStatus(`✅ Taxas atualizadas com sucesso em ${updatedRows.length} registro(s)!`);
        setProgress("");
        setFiles([]);
        document.getElementById("upload-input").value = "";
        return;
      }

      // ==========================================
      // MODO NORMAL: planilhas principais presentes
      // ==========================================
      setProgress("3/5: Processando planilhas principais...");

      if (mainFiles.length === 0) {
        throw new Error("Nenhum arquivo principal encontrado e nenhuma taxa extraída. Verifique os arquivos.");
      }

      let allExtractedRows = [];
      for (let mf of mainFiles) {
        const rawData = XLSX.utils.sheet_to_json(mf.worksheet, { defval: null });
        rawData.forEach(row => {
          const newRow = {};
          for (let key in row) {
            const cleanKey = String(key).trim();
            if (cleanKey.startsWith("__EMPTY") || cleanKey === "id" || cleanKey === "created_at") continue;
            let val = row[key];
            if (["Dt.Emis", "Vcto", "Pgto"].includes(cleanKey)) val = cleanDate(val);
            else if (["Vl Pgto", "Entrada", "Rec."].includes(cleanKey)) val = cleanNumber(val);
            else if (["Cód.Red", "Borderô"].includes(cleanKey)) { val = parseFloat(val); if (isNaN(val)) val = null; }
            else if (cleanKey === "UF" && val) val = String(val).trim().toUpperCase().slice(0, 2);
            newRow[cleanKey] = val;
          }

          if (newRow["Borderô"]) {
            const bNum = parseInt(newRow["Borderô"], 10);
            if (globalRatesMap[bNum]) {
              newRow["Desagio"] = globalRatesMap[bNum].Desagio;
              newRow["Tx.Efet"] = globalRatesMap[bNum]["Tx.Efet"];
            }
          }

          if (limpaChave(newRow["Cód.Red"]) !== "" && String(newRow["Cliente"]).trim() !== "Número de Itens") {
            allExtractedRows.push(newRow);
          }
        });
      }

      if (allExtractedRows.length === 0) throw new Error("Nenhuma linha extraída dos arquivos. Verifique as planilhas.");

      setProgress("4/5: Consolidando e limpando dados...");

      // 4. SOMA DO "0 -" E LIMPEZA
      const groupedByDcto = {};
      allExtractedRows.forEach(r => {
        const groupKey = `${limpaChave(r["Cliente"])}_${limpaChave(r["Dcto"])}`;
        if (!groupedByDcto[groupKey]) groupedByDcto[groupKey] = [];
        groupedByDcto[groupKey].push(r);
      });

      const rowsAfterSum = [];
      for (let key in groupedByDcto) {
        const group = groupedByDcto[key];
        if (group.length === 1) rowsAfterSum.push(group[0]);
        else {
          let bestRow = group.find(r => {
            const s = String(r["Sacado"] || "").trim().replace(/\s/g, "");
            return !(s.startsWith("0-") || s === "0" || s === "");
          }) || group[0];
          const totalPgto = group.reduce((acc, curr) => acc + (cleanNumber(curr["Vl Pgto"]) || 0), 0);
          rowsAfterSum.push({ ...bestRow, "Vl Pgto": totalPgto });
        }
      }

      const finalRows = [];
      const seenCodRed = new Set();
      rowsAfterSum.forEach(r => {
        const codRedVal = limpaChave(r["Cód.Red"]);
        if (!codRedVal) return;
        const sacadoStr = String(r["Sacado"] || "").trim().replace(/\s/g, "");
        if (sacadoStr.startsWith("0-") || sacadoStr === "0") return;
        if (!seenCodRed.has(codRedVal)) {
          seenCodRed.add(codRedVal);
          finalRows.push(r);
        }
      });

      setProgress(`5/5: Enviando ${finalRows.length} registros para o Supabase (Preservando taxas)...`);

      // 5. ENVIO COM PRESERVAÇÃO DE TAXAS
      const BATCH_SIZE = 500;
      let upsertedCount = 0;

      for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
        const batch = finalRows.slice(i, i + BATCH_SIZE);
        const codReds = batch.map(r => r["Cód.Red"]);

        // FIX: usar select('*') e .in com aspas duplas para colunas com ponto no nome
        const { data: existingData, error: fetchErr } = await supabase
          .from("secInfo")
          .select('*')
          .in('"Cód.Red"', codReds);

        if (fetchErr) throw new Error(`Erro ao checar banco: ${fetchErr.message}`);

        const existingMap = {};
        if (existingData) {
          existingData.forEach(r => existingMap[r["Cód.Red"]] = r);
        }

        // Se o lote novo tiver taxa vazia, copia do banco
        const finalBatch = batch.map(row => {
          const existingRow = existingMap[row["Cód.Red"]];
          if (existingRow) {
            if (row["Desagio"] === null || row["Desagio"] === undefined) {
              row["Desagio"] = existingRow.Desagio;
            }
            if (row["Tx.Efet"] === null || row["Tx.Efet"] === undefined) {
              row["Tx.Efet"] = existingRow["Tx.Efet"];
            }
          }
          return row;
        });

        const { error } = await supabase
          .from("secInfo")
          .upsert(finalBatch, { onConflict: '"Cód.Red"' });

        if (error) throw new Error(`Erro no envio: ${error.message}`);

        upsertedCount += batch.length;
        setProgress(`Enviando... ${upsertedCount} / ${finalRows.length}`);
      }

      setStatus("✅ Banco de dados atualizado com sucesso!");
      setProgress("");
      setFiles([]);
      document.getElementById("upload-input").value = "";

    } catch (err) {
      setStatus(`❌ Erro: ${err.message}`);
      setProgress("");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "#fff", padding: "32px", borderRadius: "12px", boxShadow: "0 8px 20px rgba(0,0,0,0.06)", maxWidth: "600px", margin: "0 auto", border: "1px solid #e5e7eb" }}>
      <h2 style={{ marginTop: 0, color: "#111827", fontSize: "20px" }}>Atualização de Dados</h2>
      <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "20px" }}>
        Selecione todos os arquivos de dados do Borderô e/ou dados de Taxas.
      </p>

      {/* BOX DE INSTRUÇÕES DE EXTRAÇÃO */}
      <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "24px", fontSize: "13px", color: "#334155", lineHeight: "1.5" }}>
        <div style={{ marginBottom: "12px" }}>
          <strong style={{ color: "#0f172a", fontSize: "14px" }}>📄 Arquivo de Operações:</strong><br />
          Ir em Contas <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Lançamentos <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Busca Avançada <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Vencimento = Todos ; a Receber ; OK <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Imprimir (Primeiro Ícone) <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Resumido - Modelo 2 <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Exportar para Excel
        </div>
        <div>
          <strong style={{ color: "#0f172a", fontSize: "14px" }}>📊 Arquivo de Taxas (Método Muito Lento):</strong><br />
          Ir em Gerência <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Operações <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          C. Própria <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Aquisições no Período - Resumo <span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Seleciona APENAS Período Desejado (Método Muito Lento)<span style={{ color: "#94a3b8", margin: "0 4px" }}>➔</span> 
          Exportar para Planilha do Excel (Penúltimo Ícone)
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <input
          id="upload-input"
          type="file"
          multiple
          accept=".xlsx, .xls"
          onChange={(e) => setFiles(Array.from(e.target.files))}
          disabled={loading}
          style={{ 
            boxSizing: "border-box", // <-- Correção da largura adicionada aqui
            width: "100%", 
            padding: "12px", 
            border: "2px dashed #cbd5e1", 
            borderRadius: "8px", 
            background: "#f8fafc", 
            cursor: "pointer" 
          }}
        />
        <div style={{ fontSize: "13px", color: "#64748b", marginTop: "8px", fontWeight: "500" }}>
          {files.length} arquivo(s) selecionado(s).
        </div>
      </div>

      <button
        onClick={processAllFiles}
        disabled={loading || files.length === 0}
        style={{
          boxSizing: "border-box", // <-- Correção da largura adicionada aqui
          width: "100%", 
          padding: "12px", 
          borderRadius: "8px", 
          border: "none",
          background: (loading || files.length === 0) ? "#9ca3af" : "#4f46e5",
          color: "#fff", 
          fontWeight: "600", 
          fontSize: "15px", 
          cursor: (loading || files.length === 0) ? "not-allowed" : "pointer",
          transition: "background 0.2s"
        }}
      >
        {loading ? "Processando..." : "Processar e Enviar"}
      </button>

      {progress && (
        <div style={{ marginTop: "16px", fontSize: "14px", color: "#4f46e5", fontWeight: "600", textAlign: "center" }}>{progress}</div>
      )}

      {status && (
        <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: status.includes("❌") ? "#fef2f2" : "#ecfdf5", color: status.includes("❌") ? "#991b1b" : "#065f46", fontWeight: "500", fontSize: "14px", textAlign: "center" }}>
          {status}
        </div>
      )}
    </div>
  );
}