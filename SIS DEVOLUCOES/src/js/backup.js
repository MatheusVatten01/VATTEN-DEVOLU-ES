/* =========================================================================
   BACKUP.JS — backup JSON, restauração e planilha CSV.
   ========================================================================= */
'use strict';

function gerarBackup() {
  return JSON.stringify({ formato: FORMATO_BACKUP, geradoEm: new Date().toISOString(), ...banco }, null, 2);
}

/** Lê o texto de um backup e devolve o banco pronto para uso. Aceita também
    backups do esboço inicial (sem o campo "formato"). Lança Error se for inválido. */
function lerBackup(textoArquivo) {
  const dados = JSON.parse(textoArquivo);
  if (dados.formato && dados.formato !== FORMATO_BACKUP)
    throw new Error(`arquivo de outro sistema (${dados.formato})`);
  return migrarBanco(dados);
}

function fazerBackup() {
  baixarArquivo(`backup-devolucoes-${hojeISO()}.json`, gerarBackup(), 'application/json');
  toast('Backup gerado. Guarde o arquivo em local seguro.');
}

async function restaurarBackup(evento) {
  const arquivo = evento.target.files[0];
  evento.target.value = '';
  if (!arquivo) return;
  let novo;
  try {
    novo = lerBackup(await arquivo.text());
  } catch (erro) {
    alert('Arquivo de backup inválido: ' + erro.message);
    return;
  }
  if (!confirm(`Restaurar ${novo.devolucoes.length} devolução(ões)? Os dados atuais serão substituídos.`)) return;
  banco = novo;
  // Restaurar um backup válido resolve uma falha de leitura na abertura.
  erroCarregamento = '';
  if (salvar()) toast('Backup restaurado.');
  navegar();
}

const COLUNAS_CSV = [
  ['Código', (d) => d.codigo],
  ['Abertura', (d) => dataBR(d.abertura)],
  ['Status', (d) => texto('status', d.status)],
  ['Pedido', (d) => d.pedido],
  ['Canal', (d) => texto('canais', d.canal)],
  ['Cliente', (d) => d.cliente],
  ['CPF', (d) => d.cpf],
  ['Contato', (d) => d.contato],
  ['Produto', (d) => d.produto],
  ['Quantidade', (d) => d.quantidade],
  ['Tipo', (d) => texto('tipos', d.tipo)],
  ['Motivo', (d) => texto('motivos', d.motivo)],
  ['Entrega', (d) => dataBR(d.entrega)],
  ['Prazo', (d) => dataBR(prazoDe(d))],
  ['Valor produto', (d) => d.valorProduto],
  ['Frete reverso', (d) => d.frete],
  ['Rastreio', (d) => d.rastreio],
  ['Resolução', (d) => (d.resolucao ? texto('solucoes', d.resolucao) : '')],
  ['Valor reembolsado', (d) => d.valorReembolso ?? ''],
  ['Destino', (d) => (d.destino ? texto('destinos', d.destino) : '')],
  ['CFOP', (d) => d.cfop],
  ['NF-e entrada', (d) => d.nfEntrada],
  ['Parecer', (d) => d.parecer],
];

/** Planilha CSV (abre no Excel). Usa ; como separador e vírgula decimal, padrão do Excel em português. */
function gerarCsv(devolucoes) {
  const celula = (v) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [
    COLUNAS_CSV.map((c) => c[0]).join(';'),
    ...devolucoes.map((d) => COLUNAS_CSV.map((c) => celula(c[1](d))).join(';')),
  ];
  // BOM no início para o Excel reconhecer UTF-8 (acentos).
  return '﻿' + linhas.join('\r\n');
}

function exportarCsv() {
  baixarArquivo(`devolucoes-${hojeISO()}.csv`, gerarCsv(banco.devolucoes), 'text/csv;charset=utf-8');
}
