import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { pdfBase64 } = await req.json()
    if (!pdfBase64) throw new Error('Nenhum arquivo PDF enviado.')

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiKey}`

    const payload = {
      contents: [{
        parts: [
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
          { text: `Analise a nota fiscal (DANFE). Extraia TODOS os dados solicitados.
          
          REGRAS:
          1. Remova pontuação de CNPJ, CPF, CEP e Inscrição Estadual (somente números).
          2. Formate datas de emissão/saída como YYYY-MM-DDTHH:mm:ss-03:00. Datas de duplicatas apenas YYYY-MM-DD.
          3. Valores monetários devem usar ponto (.) para decimais. Ex: 2700.00.
          4. COBRANÇA: Se não houver duplicatas claras, crie 1 parcela (nDup: 001) com o valor total da nota, para vencimento 1 ano após a emissão.` }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            // ... (outros campos de identificação) ...
            chave_acesso: { type: "STRING", description: "Chave de 44 números" },
            protocolo: { type: "STRING", description: "Protocolo de autorização (apenas números)" },
            
            // 🔥 MUDANÇA AQUI: Instruções rígidas de formatação
            numero_nfe: { 
              type: "STRING", 
              description: "Número da nota fiscal. OBRIGATÓRIO: Remova todos os pontos e remova todos os zeros à esquerda. Ex: se estiver '000.002.895', retorne apenas '2895'." 
            },
            serie_nfe: { type: "STRING" },
            natureza_operacao: { type: "STRING" },
            data_emissao: { type: "STRING" },
            data_saida: { type: "STRING" },

            // ... (campos de emitente, destinatário e totais iguais ao anterior) ...
            emit_cnpj: { type: "STRING" },
            emit_nome: { type: "STRING" },
            emit_lgr: { type: "STRING" },
            emit_nro: { type: "STRING" },
            emit_bairro: { type: "STRING" },
            emit_mun: { type: "STRING" },
            emit_uf: { type: "STRING" },
            emit_cep: { type: "STRING" },
            emit_ie: { type: "STRING" },
            dest_cnpj_cpf: { type: "STRING" },
            dest_nome: { type: "STRING" },
            dest_lgr: { type: "STRING" },
            dest_nro: { type: "STRING" },
            dest_bairro: { type: "STRING" },
            dest_mun: { type: "STRING" },
            dest_uf: { type: "STRING" },
            dest_cep: { type: "STRING" },
            dest_ie: { type: "STRING" },
            v_bc: { type: "STRING" },
            v_icms: { type: "STRING" },
            v_prod: { type: "STRING" },
            v_nf: { type: "STRING" },
            v_tot_trib: { type: "STRING" },

            // 🔥 MUDANÇA AQUI TAMBÉM: Regra para as duplicatas
            duplicatas: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  nDup: { 
                    type: "STRING", 
                    description: "Número da parcela. OBRIGATÓRIO: Remova todos os zeros à esquerda, mesmo após barras. Ex: se for '001', retorne '1'. Se for '000420/001', retorne '420/1'." 
                  },
                  dVenc: { type: "STRING" },
                  vDup: { type: "STRING" }
                },
                required: ["nDup", "dVenc", "vDup"]
              }
            },
            endereco_limpo: { type: "STRING", description: "Apenas: Rua, Número, Bairro, Cidade. Sem complementos como galpão, lote." }
          },
          // ... (required iguais ao anterior) ...
          required: [
            "chave_acesso", "numero_nfe", "serie_nfe", "data_emissao", "data_saida",
            "emit_cnpj", "emit_nome", "dest_cnpj_cpf", "dest_nome",
            "v_prod", "v_nf", "duplicatas", "endereco_limpo"
          ]
        }
      }
    }

    // 1. Pede os dados extraídos pro Gemini
    const geminiRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await geminiRes.json()
    if (!geminiRes.ok) throw new Error(data.error?.message || 'Erro na API do Gemini')

    const resultadoJson = JSON.parse(data.candidates[0].content.parts[0].text)

    // 2. Transforma o endereço limpo em Lat/Lng usando o Google Geocoding API
    let lat = null, lng = null;
    if (resultadoJson.endereco_limpo) {
      const googleKey = Deno.env.get('GOOGLE_MAPS_KEY');
      if (googleKey) {
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(resultadoJson.endereco_limpo)}&key=${googleKey}`
        const geoRes = await fetch(geoUrl)
        const geoData = await geoRes.json()
        
        if (geoData.results && geoData.results.length > 0) {
          lat = geoData.results[0].geometry.location.lat
          lng = geoData.results[0].geometry.location.lng
        }
      }
    }

    // Devolve para o React o JSON original do Gemini + As coordenadas do Google
    return new Response(JSON.stringify({ ...resultadoJson, lat, lng }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})