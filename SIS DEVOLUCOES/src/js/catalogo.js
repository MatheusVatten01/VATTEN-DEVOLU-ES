/* =========================================================================
   CATALOGO.JS — tabela SKU → nome real do produto.
   O anúncio do Mercado Livre nem sempre tem o nome do cadastro; ao importar
   uma devolução, o nome vem desta tabela pelo SKU (seller_sku do pedido).
   A tabela é importada da planilha de precificação (CSV) na tela Configurações:
   só as colunas Sku e Descrição são lidas; custos e preços não são guardados.
   Fica no navegador (CHAVE_CATALOGO) e vai junto no backup.
   ========================================================================= */
'use strict';

// { itens: { SKU_NORMALIZADO: { sku, nome } }, total, importadoEm, arquivo, avisos: [] }
let catalogoProdutos = { itens: {}, total: 0, importadoEm: '', arquivo: '', avisos: [] };

function carregarCatalogo() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CATALOGO));
    if (salvo && salvo.itens) catalogoProdutos = salvo;
  } catch (erro) {
    console.error(erro);
  }
}

function salvarCatalogo() {
  try {
    localStorage.setItem(CHAVE_CATALOGO, JSON.stringify(catalogoProdutos));
    return true;
  } catch (erro) {
    console.error(erro);
    alert('Não foi possível salvar a tabela de produtos neste navegador.');
    return false;
  }
}

/** Forma usada para comparar SKUs: maiúsculas, sem espaços. */
function normalizarSku(sku) {
  return String(sku ?? '')
    .replace(/[\s ]+/g, '')
    .toUpperCase();
}

/** Comparação tolerante: só letras e números (03.0024.0500.01 = 03002405001). */
function skuCompacto(sku) {
  return normalizarSku(sku).replace(/[^0-9A-Z]/g, '');
}

/** Nome real cadastrado para o SKU, ou '' se não estiver na tabela. */
function nomeRealDoSku(sku) {
  if (!sku) return '';
  const itens = catalogoProdutos.itens || {};
  const exato = itens[normalizarSku(sku)];
  if (exato) return exato.nome;
  const compacto = skuCompacto(sku);
  if (!compacto) return '';
  const parecido = Object.values(itens).find((p) => skuCompacto(p.sku) === compacto);
  return parecido ? parecido.nome : '';
}

/* ---------------------------- Leitura do CSV ---------------------------- */

/** Texto do arquivo: UTF-8 se for válido; senão Windows-1252 (padrão do Excel em português). */
function decodificarCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Divide uma linha CSV respeitando aspas ("a;b" é um campo só). */
function dividirLinhaCsv(linha, separador) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) {
      campos.push(atual);
      atual = '';
    } else atual += c;
  }
  campos.push(atual);
  return campos.map((s) => s.trim());
}

const semAcento = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Lê o texto da planilha e devolve { itens, total, avisos }. Lança Error se não achar as colunas. */
function lerTabelaProdutos(texto) {
  const linhas = texto.split(/\r?\n/);
  let cabecalho = -1;
  let separador = ';';
  let colSku = -1;
  let colNome = -1;
  // O cabeçalho não fica na 1ª linha (a planilha tem um bloco de parâmetros antes).
  for (let i = 0; i < Math.min(linhas.length, 200) && cabecalho < 0; i++) {
    for (const sep of [';', ',', '\t']) {
      const campos = dividirLinhaCsv(linhas[i], sep).map(semAcento);
      const s = campos.indexOf('sku');
      const n = campos.findIndex((c) => c === 'descricao' || c === 'nome' || c === 'produto');
      if (s >= 0 && n >= 0) {
        [cabecalho, separador, colSku, colNome] = [i, sep, s, n];
        break;
      }
    }
  }
  if (cabecalho < 0)
    throw new Error('Não encontrei as colunas "Sku" e "Descrição" na planilha. Confira se é a tabela de precificação.');

  const itens = {};
  const avisos = [];
  let semSku = 0;
  for (let i = cabecalho + 1; i < linhas.length; i++) {
    if (!/[^;,\t\s ]/.test(linhas[i])) continue; // linha vazia
    const campos = dividirLinhaCsv(linhas[i], separador);
    const sku = campos[colSku] || '';
    const nome = (campos[colNome] || '').replace(/\s+/g, ' ').trim();
    if (!nome) continue;
    if (!sku || /^[-–—]+$/.test(sku)) {
      semSku++;
      continue;
    }
    const chave = normalizarSku(sku);
    if (itens[chave]) {
      if (itens[chave].nome !== nome)
        avisos.push(`SKU ${sku} aparece mais de uma vez; mantido "${itens[chave].nome}", ignorado "${nome}".`);
      continue;
    }
    itens[chave] = { sku: sku.trim(), nome };
  }
  if (semSku) avisos.unshift(`${semSku} produto(s) sem SKU (vazio ou "-") foram ignorados.`);
  const total = Object.keys(itens).length;
  if (!total) throw new Error('A planilha não tem nenhum produto com SKU.');
  return { itens, total, avisos };
}

/* ------------------------ Aplicar nas devoluções ------------------------ */

/** Troca o nome do produto das devoluções do ML pelo nome real do SKU. Retorna quantas mudaram. */
function corrigirNomesML() {
  let corrigidas = 0;
  for (const d of banco.devolucoes) {
    if (d.origem !== 'mercadolivre' || !d.ml) continue;
    // Importadas antes de 26/10/2026 não guardavam sku/título à parte: produto era "SKU · título".
    if (!d.ml.sku && String(d.produto).includes(' · ')) {
      const [sku, ...resto] = d.produto.split(' · ');
      d.ml.sku = sku.trim();
      d.ml.tituloAnuncio = d.ml.tituloAnuncio || resto.join(' · ').trim();
    }
    if (!d.ml.sku) continue;
    const produto = montarNomeProduto(d.ml.sku, nomeRealDoSku(d.ml.sku) || d.ml.tituloAnuncio);
    if (produto && produto !== d.produto) {
      d.produto = produto;
      corrigidas++;
    }
  }
  return corrigidas;
}

/** "SKU · Nome" (ou só o que existir). */
function montarNomeProduto(sku, nome) {
  return [sku, nome].filter(Boolean).join(' · ');
}

/* --------------------- Compartilhar pela ponte do ML --------------------- */

/** Mantém a tabela igual em todos os computadores: a importação mais recente vence.
    Ponte mais nova → baixa e corrige as devoluções; local mais nova → envia para a ponte.
    Retorna 'sem_ponte' | 'baixada' | 'enviada' | 'igual'. Lança Error se a ponte falhar. */
async function sincronizarCatalogoPonte() {
  if (!mlConfigurado()) return 'sem_ponte';
  const { catalogo: remoto } = await chamarPonte('/produtos');
  const quando = (c) => (c?.itens && c.total ? Date.parse(c.importadoEm) || 0 : -1);
  const [tRemoto, tLocal] = [quando(remoto), quando(catalogoProdutos)];
  if (tRemoto > tLocal) {
    catalogoProdutos = remoto;
    salvarCatalogo();
    if (corrigirNomesML()) salvar();
    return 'baixada';
  }
  if (tLocal > tRemoto) {
    await chamarPonte('/produtos', {
      method: 'POST',
      body: JSON.stringify(catalogoProdutos),
      headers: { 'Content-Type': 'application/json' },
    });
    return 'enviada';
  }
  return 'igual';
}

/* --------------------------------- Tela --------------------------------- */

async function importarTabelaProdutos(evento) {
  const arquivo = evento.target.files[0];
  evento.target.value = '';
  if (!arquivo) return;
  let tabela;
  try {
    tabela = lerTabelaProdutos(decodificarCsv(await arquivo.arrayBuffer()));
  } catch (erro) {
    alert('Não foi possível ler a planilha: ' + erro.message);
    return;
  }
  catalogoProdutos = {
    ...tabela,
    importadoEm: new Date().toISOString(),
    arquivo: arquivo.name,
  };
  if (!salvarCatalogo()) return;
  const corrigidas = corrigirNomesML();
  if (corrigidas) salvar();
  let compartilhada = '';
  try {
    compartilhada =
      (await sincronizarCatalogoPonte()) === 'enviada' ? ' Enviada para os outros computadores pela ponte.' : '';
  } catch (erro) {
    compartilhada = ` Não foi possível enviar para a ponte (${erro.message}); os outros computadores ainda não a receberam.`;
  }
  toast(
    `${tabela.total} produto(s) importado(s).${corrigidas ? ` ${corrigidas} devolução(ões) corrigida(s).` : ''}${compartilhada}`,
  );
  renderCatalogo();
}

function renderCatalogo() {
  const c = catalogoProdutos;
  $('catResumo').textContent = c.total
    ? `${c.total} produtos na tabela · importada em ${dataHoraBR(c.importadoEm)}${c.arquivo ? ` (${c.arquivo})` : ''}` +
      (mlConfigurado() ? ' · compartilhada com os outros computadores pela ponte' : '')
    : 'Nenhuma tabela importada: as devoluções do ML ficam com o nome do anúncio.';
  const avisos = c.avisos || [];
  $('catAvisos').classList.toggle('oculto', !avisos.length);
  $('catAvisos').innerHTML = avisos.length
    ? `<b>Avisos da importação:</b><ul>${avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
    : '';
  // Devoluções do ML cujo SKU não está na tabela (o nome continua o do anúncio).
  const faltando = [
    ...new Set(
      banco.devolucoes
        .filter((d) => d.origem === 'mercadolivre' && d.ml?.sku && !nomeRealDoSku(d.ml.sku))
        .map((d) => d.ml.sku),
    ),
  ];
  $('catFaltando').classList.toggle('oculto', !c.total || !faltando.length);
  $('catFaltando').innerHTML = faltando.length
    ? `<b>SKUs de devoluções que não estão na tabela:</b> ${faltando.map(esc).join(', ')}`
    : '';
}
