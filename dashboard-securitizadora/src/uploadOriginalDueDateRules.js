export const IMPORT_ORIGINAL_VCTO_FIELD = "__importOriginalVcto";

const cleanKeyPart = (value) => {
  if (value === null || value === undefined) return "";
  let normalized = String(value).trim();
  if (normalized.endsWith(".0")) normalized = normalized.slice(0, -2);
  return normalized;
};

export const getImportMatchVcto = (row) =>
  row?.[IMPORT_ORIGINAL_VCTO_FIELD] || row?.Vcto || null;

export const getImportMatchVctos = (row) =>
  Array.from(
    new Set(
      [getImportMatchVcto(row), row?.Vcto].filter(
        (value) => value !== null && value !== undefined && String(value).trim() !== ""
      )
    )
  );

export const buildImportTitleKey = (row, useOriginalVcto = false) => {
  const vcto = useOriginalVcto ? getImportMatchVcto(row) : row?.Vcto;
  return `${cleanKeyPart(row?.Dcto)}__${cleanKeyPart(row?.["Borderô"])}__${cleanKeyPart(vcto)}`;
};

export const stripImportMetadata = (row) => {
  const copy = { ...row };
  delete copy[IMPORT_ORIGINAL_VCTO_FIELD];
  return copy;
};
