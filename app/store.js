// Persistência simples em arquivo JSON (MVP local — trocar por DB na nuvem)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARQUIVO = path.join(path.dirname(fileURLToPath(import.meta.url)), "data.json");

let dados = { clientes: [] };
try {
  dados = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
} catch {}

let salvarAgendado = null;
function salvar() {
  clearTimeout(salvarAgendado);
  salvarAgendado = setTimeout(() => {
    fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2));
  }, 150);
}

export function listarClientes() {
  return dados.clientes;
}

export function obterCliente(id) {
  return dados.clientes.find((c) => c.id === id) || null;
}

export function criarCliente(cliente) {
  dados.clientes.push(cliente);
  salvar();
  return cliente;
}

export function atualizarCliente(id, mudancas) {
  const c = obterCliente(id);
  if (!c) return null;
  Object.assign(c, mudancas);
  salvar();
  return c;
}

export function persistir() {
  salvar();
}
