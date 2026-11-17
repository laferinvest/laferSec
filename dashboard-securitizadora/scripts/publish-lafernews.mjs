import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";

const [directory] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function publish() {
  if (!directory || !url || !key) {
    throw new Error("Informe a pasta preparada, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }
  const root = resolve(directory);
  const manifest = await readFile(resolve(root, "execucao.json"));
  const run = JSON.parse(manifest);
  if (run.version !== 1 || !/^EXEC-\d{8}-[a-f0-9]+-R\d+$/.test(run.revision)) {
    throw new Error("Manifesto de execução inválido.");
  }
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage;
  const { data: bucket, error } = await storage.getBucket("lafernews");
  if (error) throw error;
  if (bucket.public !== false) throw new Error("O bucket lafernews precisa ser privado.");
  const objects = storage.from("lafernews");

  async function uploadImmutable(path, bytes, contentType) {
    const { error: uploadError } = await objects.upload(path, bytes, {
      contentType,
      cacheControl: "0",
      upsert: false,
    });
    if (!uploadError) return;
    if (!/already exists|duplicate/i.test(uploadError.message) && String(uploadError.statusCode) !== "409") {
      throw uploadError;
    }
    const { data, error: downloadError } = await objects.download(path);
    if (downloadError) throw downloadError;
    if (!bytes.equals(Buffer.from(await data.arrayBuffer()))) {
      throw new Error(`A revisão já existe com conteúdo diferente: ${path}`);
    }
  }

  const originals = resolve(root, "originais");
  const files = await Promise.all(run.originals.map(async ({ path, sha256 }) => {
    const local = resolve(originals, path);
    if (!local.startsWith(originals + sep) || !path.endsWith(".md")) {
      throw new Error(`Caminho de original inválido: ${path}`);
    }
    const bytes = await readFile(local);
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      throw new Error(`Original alterado após importação: ${path}`);
    }
    return { path, bytes };
  }));

  for (const { path, bytes } of files) {
    await uploadImmutable(`${run.revision}/${path}`, bytes, "text/markdown");
  }
  await uploadImmutable(`${run.revision}.json`, manifest, "application/json");
  const { data, error: verifyError } = await objects.download(`${run.revision}.json`);
  if (verifyError) throw verifyError;
  if (!manifest.equals(Buffer.from(await data.arrayBuffer()))) {
    throw new Error("O manifesto publicado difere do arquivo preparado.");
  }
  console.log(`Publicado e conferido: ${run.revision} (${files.length} originais).`);
}

publish().catch((error) => {
  console.error(`Publicação interrompida: ${error.message}`);
  process.exitCode = 1;
});
