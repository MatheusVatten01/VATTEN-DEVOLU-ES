/* =========================================================================
   APP.JS — Sistema de Controle de Devoluções
   Roda direto no navegador (duplo clique no index.html). Os dados ficam
   salvos no próprio navegador (localStorage) — faça backup pelo menu.

   Seções:
     1. Configuração (textos, prazos, etapas)
     2. Utilitários (datas, dinheiro, HTML)
     3. Dados (salvar, carregar, regras)
     4. Navegação entre telas
     5. Tela Painel
     6. Tela Lista
     7. Tela Nova devolução
     8. Tela Detalhe
     9. Backup e exportação
    10. Inicialização
   ========================================================================= */
'use strict';

/* ============================ 1. CONFIGURAÇÃO ============================ */

const CHAVE_ARMAZENAMENTO = 'devolucoes_v1';

const OPCOES = {
  status: {
    solicitada: 'Solicitada',
    aprovada: 'Aprovada',
    transito: 'Em trânsito',
    inspecao: 'Em inspeção',
    concluida: 'Concluída',
    recusada: 'Recusada',
  },
  tipos: {
    arrependimento: 'Arrependimento',
    defeito: 'Defeito',
    troca: 'Troca (tamanho/cor)',
    erro_envio: 'Erro de envio',
  },
  canais: {
    loja: 'Loja própria',
    mercadolivre: 'Mercado Livre',
    shopee: 'Shopee',
    amazon: 'Amazon',
    fisica: 'Loja física',
  },
  motivos: {
    tamanho: 'Tamanho não serviu',
    nao_gostou: 'Não gostou',
    defeito: 'Produto com defeito',
    avariado: 'Chegou avariado',
    diferente: 'Diferente do anúncio',
    errado: 'Produto errado enviado',
    outro: 'Outro',
  },
  solucoes: { reembolso: 'Reembolso', troca: 'Troca', credito: 'Crédito na loja' },
  estados: { A: 'A · Como novo', B: 'B · Pequeno defeito', C: 'C · Sem condição de venda' },
  destinos: {
    estoque: 'Voltar ao estoque',
    outlet: 'Outlet / promoção',
    fornecedor: 'Devolver ao fornecedor',
    conserto: 'Conserto',
    descarte: 'Descarte',
  },
  // Confirme os CFOPs com o seu contador.
  cfops: {
    1202: '1.202 · Mesmo estado',
    2202: '2.202 · Outro estado',
    1411: '1.411 · Mesmo estado com ST',
    2411: '2.411 · Outro estado com ST',
  },
};

// Prazo em dias corridos a partir da entrega.
// Arrependimento: 7 dias (CDC art. 49). Defeito: 90 dias para bens duráveis (CDC art. 26).
// Troca e erro de envio: política da loja — ajuste aqui.
const PRAZO_DIAS = { arrependimento: 7, defeito: 90, troca: 30, erro_envio: 30 };

// Ordem das etapas e o texto do botão que leva para a próxima.
const ETAPAS = ['solicitada', 'aprovada', 'transito', 'inspecao', 'concluida'];
const BOTAO_AVANCAR = {
  solicitada: 'Aprovar devolução',
  aprovada: 'Registrar envio (em trânsito)',
  transito: 'Confirmar recebimento',
};
const ABERTAS = ['solicitada', 'aprovada', 'transito', 'inspecao'];

/* ============================ 2. UTILITÁRIOS ============================= */

const $ = (id) => document.getElementById(id);

/** Data de hoje no fuso do computador, no formato AAAA-MM-DD. */
function hojeISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function somarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d + dias));
}

function diasEntre(isoInicio, isoFim) {
  const [a1, m1, d1] = isoInicio.split('-').map(Number);
  const [a2, m2, d2] = isoFim.split('-').map(Number);
  return Math.round((new Date(a2, m2 - 1, d2) - new Date(a1, m1 - 1, d1)) / 86400000);
}

function dataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function dataHoraBR(isoCompleto) {
  if (!isoCompleto) return '—';
  return new Date(isoCompleto).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function reais(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Protege textos digitados antes de colocar no HTML. */
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function texto(grupo, chave) {
  return OPCOES[grupo][chave] ?? chave ?? '—';
}

function toast(mensagem) {
  const t = $('toast');
  t.textContent = mensagem;
  t.classList.add('toast--visivel');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('toast--visivel'), 3000);
}

/** Preenche todos os <select data-opcoes="..."> com as opções da configuração. */
function preencherSelects() {
  document.querySelectorAll('select[data-opcoes]').forEach((sel) => {
    const grupo = OPCOES[sel.dataset.opcoes];
    const todos = sel.dataset.todos ? `<option value="">${esc(sel.dataset.todos)}</option>` : '';
    sel.innerHTML = todos + Object.entries(grupo).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  });
}

/* =============================== 3. DADOS ================================ */

let banco = { proximoNumero: 1, devolucoes: [] };

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ARMAZENAMENTO));
    if (salvo && Array.isArray(salvo.devolucoes)) banco = salvo;
  } catch (erro) {
    console.error(erro);
    toast('Não foi possível ler os dados salvos.');
  }
}

function salvar() {
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(banco));
  } catch (erro) {
    console.error(erro);
    alert('Não foi possível salvar. Faça um backup agora para não perder dados.');
  }
}

function buscar(codigo) {
  return banco.devolucoes.find((d) => d.codigo === codigo);
}

/** Prazo final para o cliente devolver (entrega + dias do tipo). */
function prazoDe(d) {
  return somarDias(d.entrega, PRAZO_DIAS[d.tipo] ?? 30);
}

/** Dias que faltam até o prazo (negativo = vencido). */
function diasRestantes(d) {
  return diasEntre(hojeISO(), prazoDe(d));
}

function registrarEtapa(d, status, nota = '') {
  d.status = status;
  d.historico.push({ status, em: new Date().toISOString(), nota });
}

function criarDevolucao(campos) {
  const codigo = `DV-${String(banco.proximoNumero).padStart(4, '0')}`;
  banco.proximoNumero += 1;
  const d = {
    codigo,
    abertura: hojeISO(),
    ...campos,
    status: 'solicitada',
    historico: [],
  };
  registrarEtapa(d, 'solicitada');
  banco.devolucoes.push(d);
  salvar();
  return d;
}

/* ======================== 4. NAVEGAÇÃO ENTRE TELAS ======================= */

/** Lê o endereço (#painel, #lista, #nova, #detalhe/DV-0001) e mostra a tela certa. */
function navegar() {
  const [tela, codigo] = (location.hash.slice(1) || 'painel').split('/');
  const nomeTela = ['painel', 'lista', 'nova', 'detalhe'].includes(tela) ? tela : 'painel';

  document.querySelectorAll('.tela').forEach((s) => s.classList.toggle('tela--ativa', s.id === `tela-${nomeTela}`));
  const menuAtivo = nomeTela === 'detalhe' ? 'lista' : nomeTela;
  document.querySelectorAll('.menu__link').forEach((a) => a.classList.toggle('menu__link--ativo', a.dataset.tela === menuAtivo));

  if (nomeTela === 'painel') renderPainel();
  if (nomeTela === 'lista') renderLista();
  if (nomeTela === 'nova') prepararNova();
  if (nomeTela === 'detalhe') renderDetalhe(decodeURIComponent(codigo || ''));
  window.scrollTo(0, 0);
}

/* ============================== 5. PAINEL ================================ */

function renderPainel() {
  const mes = $('painelMes').value || hojeISO().slice(0, 7);
  $('painelMes').value = mes;
  const doMes = banco.devolucoes.filter((d) => d.abertura.startsWith(mes));
  const abertas = banco.devolucoes.filter((d) => ABERTAS.includes(d.status));
  const vencendo = abertas.filter((d) => diasRestantes(d) <= 1);
  const resolvidas = doMes.filter((d) => d.status === 'concluida');
  const mantidas = resolvidas.filter((d) => ['troca', 'credito'].includes(d.resolucao));
  const frete = doMes.reduce((s, d) => s + Number(d.frete || 0), 0);

  const [ano, m] = mes.split('-');
  $('painelDescricao').textContent = `Resumo de ${new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`;
  $('kpiTotal').textContent = doMes.length;
  $('kpiTotalRodape').textContent = `${resolvidas.length} concluída(s) no mês`;
  $('kpiAbertas').textContent = abertas.length;
  $('kpiAbertasRodape').textContent = `${vencendo.length} com prazo vencendo ou vencido`;
  $('kpiTroca').textContent = resolvidas.length ? `${Math.round((mantidas.length / resolvidas.length) * 100)}%` : '0%';
  $('kpiFrete').textContent = reais(frete);
  $('kpiFreteRodape').textContent = `Média ${reais(doMes.length ? frete / doMes.length : 0)} por devolução`;

  // Motivos do mês, do mais frequente para o menos frequente
  const contagem = {};
  doMes.forEach((d) => (contagem[d.motivo] = (contagem[d.motivo] || 0) + 1));
  const motivos = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  const maior = motivos[0]?.[1] || 1;
  $('painelMotivos').innerHTML = motivos.length
    ? motivos.map(([chave, qtd]) => `
        <div class="barra">
          <div class="barra__linha"><span>${esc(texto('motivos', chave))}</span><span>${qtd}</span></div>
          <div class="barra__trilho"><div class="barra__preenchido" style="width:${Math.round((qtd / maior) * 100)}%"></div></div>
        </div>`).join('')
    : '<div class="vazio">Nenhuma devolução neste mês.</div>';

  // Prazos mais próximos entre as devoluções em aberto
  const proximos = abertas.slice().sort((a, b) => diasRestantes(a) - diasRestantes(b)).slice(0, 6);
  $('painelPrazos').innerHTML = proximos.length
    ? proximos.map((d) => `
        <tr>
          <td><a href="#detalhe/${esc(d.codigo)}">${esc(d.codigo)}</a></td>
          <td>${esc(d.cliente)}</td>
          <td class="${diasRestantes(d) <= 1 ? 'prazo-alerta' : ''}">${textoPrazo(d)}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="vazio">Nenhuma devolução em aberto.</td></tr>';
}

function textoPrazo(d) {
  const dias = diasRestantes(d);
  if (dias < 0) return `Vencido há ${-dias} dia(s)`;
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Amanhã';
  return `${dataBR(prazoDe(d))} (${dias} dias)`;
}

/* =============================== 6. LISTA ================================ */

function renderLista() {
  const busca = $('filtroBusca').value.trim().toLowerCase();
  const status = $('filtroStatus').value;
  const tipo = $('filtroTipo').value;
  const canal = $('filtroCanal').value;

  const lista = banco.devolucoes
    .filter((d) => !status || d.status === status)
    .filter((d) => !tipo || d.tipo === tipo)
    .filter((d) => !canal || d.canal === canal)
    .filter((d) => !busca || `${d.codigo} ${d.pedido} ${d.cliente} ${d.produto}`.toLowerCase().includes(busca))
    .sort((a, b) => b.codigo.localeCompare(a.codigo));

  $('listaCorpo').innerHTML = lista.length
    ? lista.map((d) => {
        const alerta = ABERTAS.includes(d.status) && diasRestantes(d) <= 1;
        return `
        <tr>
          <td><b>${esc(d.codigo)}</b></td>
          <td>#${esc(d.pedido)}</td>
          <td>${esc(d.cliente)}</td>
          <td>${esc(d.produto)}</td>
          <td>${esc(texto('tipos', d.tipo))}</td>
          <td>${esc(texto('canais', d.canal))}</td>
          <td>${dataBR(d.abertura)}</td>
          <td class="${alerta ? 'prazo-alerta' : ''}">${dataBR(prazoDe(d))}</td>
          <td><span class="status status--${esc(d.status)}">${esc(texto('status', d.status))}</span></td>
          <td><a class="botao botao--pequeno botao--secundario" href="#detalhe/${esc(d.codigo)}">Abrir</a></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="10" class="vazio">${banco.devolucoes.length ? 'Nenhuma devolução encontrada com estes filtros.' : 'Nenhuma devolução registrada ainda.'}</td></tr>`;
}

/* =========================== 7. NOVA DEVOLUÇÃO =========================== */

function prepararNova() {
  atualizarAvisoPrazo();
}

/** Mostra um alerta se o pedido já estiver fora do prazo do tipo escolhido. */
function atualizarAvisoPrazo() {
  const entrega = $('entrega').value;
  const tipo = $('tipo').value;
  const aviso = $('avisoPrazo');
  if (!entrega || !tipo) return aviso.classList.add('oculto');
  const prazo = somarDias(entrega, PRAZO_DIAS[tipo]);
  const dias = diasEntre(hojeISO(), prazo);
  aviso.classList.toggle('oculto', dias >= 0);
  aviso.textContent = `Atenção: o prazo para ${texto('tipos', tipo).toLowerCase()} venceu em ${dataBR(prazo)} (${PRAZO_DIAS[tipo]} dias após a entrega). Você ainda pode registrar, se a loja aceitar.`;
}

function salvarNova(evento) {
  evento.preventDefault();
  const f = new FormData(evento.target);
  const campo = (nome) => String(f.get(nome) || '').trim();

  if (campo('entrega') > hojeISO()) return alert('A data de entrega não pode ser no futuro.');

  const d = criarDevolucao({
    pedido: campo('pedido').replace(/^#/, ''),
    canal: campo('canal'),
    entrega: campo('entrega'),
    nfVenda: campo('nfVenda'),
    valorProduto: Number(campo('valorProduto') || 0),
    frete: Number(campo('frete') || 0),
    cliente: campo('cliente'),
    cpf: campo('cpf'),
    contato: campo('contato'),
    produto: campo('produto'),
    quantidade: Number(campo('quantidade') || 1),
    tipo: campo('tipo'),
    motivo: campo('motivo'),
    solucao: campo('solucao'),
    observacao: campo('observacao'),
  });
  evento.target.reset();
  toast(`Devolução ${d.codigo} registrada.`);
  location.hash = `#detalhe/${d.codigo}`;
}

/* ============================== 8. DETALHE =============================== */

let codigoAberto = '';

function renderDetalhe(codigo) {
  const d = buscar(codigo);
  if (!d) {
    toast('Devolução não encontrada.');
    location.hash = '#lista';
    return;
  }
  codigoAberto = codigo;

  $('detTitulo').textContent = `Devolução ${d.codigo}`;
  $('detSubtitulo').textContent = `Pedido #${d.pedido} · ${texto('canais', d.canal)}`;
  $('detStatus').className = `status status--${d.status}`;
  $('detStatus').textContent = texto('status', d.status);

  const aberta = ABERTAS.includes(d.status);
  const item = (rotulo, valor, classe = '') => `<div class="dados__item"><small>${rotulo}</small><b class="${classe}">${valor}</b></div>`;
  $('detDados').innerHTML = [
    item('Cliente', esc(d.cliente)),
    item('CPF / contato', esc([d.cpf, d.contato].filter(Boolean).join(' · ') || '—')),
    item('Produto', `${esc(d.produto)} (${d.quantidade} un.)`),
    item('Valor do produto', reais(d.valorProduto)),
    item('Tipo / motivo', `${esc(texto('tipos', d.tipo))} · ${esc(texto('motivos', d.motivo))}`),
    item('Solução desejada', esc(texto('solucoes', d.solucao))),
    item('Entrega', dataBR(d.entrega)),
    item('Prazo', aberta ? textoPrazo(d) : dataBR(prazoDe(d)), aberta && diasRestantes(d) <= 1 ? 'prazo-alerta' : ''),
    item('Abertura', dataBR(d.abertura)),
    item('Frete reverso', reais(d.frete)),
    item('Postagem / rastreio', esc(d.rastreio || '—')),
    item('NF-e de venda', esc(d.nfVenda || '—')),
    ...(d.observacao ? [`<div class="dados__item" style="grid-column:1/-1"><small>Observações</small><b>${esc(d.observacao)}</b></div>`] : []),
  ].join('');

  renderLinhaTempo(d);

  // Mostra só o bloco que faz sentido para a etapa atual
  $('detBlocoAvancar').classList.toggle('oculto', !BOTAO_AVANCAR[d.status]);
  $('detBlocoInspecao').classList.toggle('oculto', d.status !== 'inspecao');
  $('detBlocoEncerrada').classList.toggle('oculto', aberta);

  if (BOTAO_AVANCAR[d.status]) {
    $('btnAvancar').textContent = BOTAO_AVANCAR[d.status];
    $('campoRastreio').classList.toggle('oculto', d.status !== 'aprovada');
    $('rastreio').value = d.rastreio || '';
  }
  if (d.status === 'inspecao') {
    $('resolucao').value = d.solucao || 'reembolso';
    $('valorReembolso').value = d.valorProduto || '';
  }
  if (!aberta) {
    $('detResolucao').innerHTML = d.status === 'recusada'
      ? item('Motivo da recusa', esc(d.parecer || '—'))
      : [
          item('Resolução', esc(texto('solucoes', d.resolucao))),
          item('Valor reembolsado', reais(d.valorReembolso)),
          item('Estado / destino', `${esc(d.estado)} · ${esc(texto('destinos', d.destino))}`),
          item('CFOP / NF-e de entrada', `${esc(d.cfop || '—')} · ${esc(d.nfEntrada || '—')}`),
          item('Parecer', esc(d.parecer || '—')),
        ].join('');
  }
}

function renderLinhaTempo(d) {
  const feitas = Object.fromEntries(d.historico.map((h) => [h.status, h]));
  const etapas = d.status === 'recusada' ? [...d.historico.map((h) => h.status)] : ETAPAS;
  $('detLinhaTempo').innerHTML = etapas.map((st) => {
    const h = feitas[st];
    const classe = st === d.status ? 'linha-tempo__etapa--atual' : h ? 'linha-tempo__etapa--feita' : '';
    return `<li class="linha-tempo__etapa ${classe}">
      <b>${esc(texto('status', st))}</b>
      <small>${h ? dataHoraBR(h.em) + (h.nota ? ' · ' + esc(h.nota) : '') : '—'}</small>
    </li>`;
  }).join('');
}

function avancarEtapa(evento) {
  evento.preventDefault();
  const d = buscar(codigoAberto);
  if (!d || !BOTAO_AVANCAR[d.status]) return;

  if (d.status === 'aprovada') {
    const rastreio = $('rastreio').value.trim();
    if (!rastreio) return alert('Informe o código de postagem ou rastreio.');
    d.rastreio = rastreio;
  }
  const proxima = ETAPAS[ETAPAS.indexOf(d.status) + 1];
  registrarEtapa(d, proxima, d.status === 'aprovada' ? `Rastreio ${d.rastreio}` : '');
  salvar();
  toast(`${d.codigo}: ${texto('status', proxima)}.`);
  renderDetalhe(d.codigo);
}

function concluirInspecao(evento) {
  evento.preventDefault();
  const d = buscar(codigoAberto);
  if (!d || d.status !== 'inspecao') return;
  const f = new FormData(evento.target);
  Object.assign(d, {
    estado: f.get('estado'),
    destino: f.get('destino'),
    resolucao: f.get('resolucao'),
    valorReembolso: Number(f.get('valorReembolso') || 0),
    cfop: f.get('cfop'),
    nfEntrada: String(f.get('nfEntrada') || '').trim(),
    parecer: String(f.get('parecer') || '').trim(),
  });
  registrarEtapa(d, 'concluida', texto('solucoes', d.resolucao));
  salvar();
  evento.target.reset();
  toast(`${d.codigo} concluída.`);
  renderDetalhe(d.codigo);
}

function recusar() {
  const d = buscar(codigoAberto);
  if (!d) return;
  const motivo = prompt('Motivo da recusa (obrigatório):');
  if (!motivo || !motivo.trim()) return;
  d.parecer = motivo.trim();
  registrarEtapa(d, 'recusada', d.parecer);
  salvar();
  toast(`${d.codigo} recusada.`);
  renderDetalhe(d.codigo);
}

function excluir() {
  const d = buscar(codigoAberto);
  if (!d || !confirm(`Excluir definitivamente a devolução ${d.codigo}? Esta ação não pode ser desfeita.`)) return;
  banco.devolucoes = banco.devolucoes.filter((x) => x.codigo !== d.codigo);
  salvar();
  toast(`${d.codigo} excluída.`);
  location.hash = '#lista';
}

/* ========================= 9. BACKUP E EXPORTAÇÃO ======================== */

function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fazerBackup() {
  baixarArquivo(`backup-devolucoes-${hojeISO()}.json`, JSON.stringify(banco, null, 2), 'application/json');
  toast('Backup gerado. Guarde o arquivo em local seguro.');
}

async function restaurarBackup(evento) {
  const arquivo = evento.target.files[0];
  evento.target.value = '';
  if (!arquivo) return;
  try {
    const dados = JSON.parse(await arquivo.text());
    if (!Array.isArray(dados.devolucoes) || !Number.isInteger(dados.proximoNumero)) throw new Error('formato inválido');
    if (!confirm(`Restaurar ${dados.devolucoes.length} devolução(ões)? Os dados atuais serão substituídos.`)) return;
    banco = dados;
    salvar();
    toast('Backup restaurado.');
    navegar();
  } catch (erro) {
    alert('Arquivo de backup inválido: ' + erro.message);
  }
}

/** Planilha CSV (abre no Excel). Usa ; como separador, padrão do Excel em português. */
function exportarCsv() {
  const colunas = [
    ['Código', (d) => d.codigo], ['Abertura', (d) => dataBR(d.abertura)], ['Status', (d) => texto('status', d.status)],
    ['Pedido', (d) => d.pedido], ['Canal', (d) => texto('canais', d.canal)], ['Cliente', (d) => d.cliente],
    ['CPF', (d) => d.cpf], ['Contato', (d) => d.contato], ['Produto', (d) => d.produto], ['Quantidade', (d) => d.quantidade],
    ['Tipo', (d) => texto('tipos', d.tipo)], ['Motivo', (d) => texto('motivos', d.motivo)], ['Entrega', (d) => dataBR(d.entrega)],
    ['Prazo', (d) => dataBR(prazoDe(d))], ['Valor produto', (d) => d.valorProduto], ['Frete reverso', (d) => d.frete],
    ['Rastreio', (d) => d.rastreio], ['Resolução', (d) => d.resolucao ? texto('solucoes', d.resolucao) : ''],
    ['Valor reembolsado', (d) => d.valorReembolso ?? ''], ['Destino', (d) => d.destino ? texto('destinos', d.destino) : ''],
    ['CFOP', (d) => d.cfop], ['NF-e entrada', (d) => d.nfEntrada], ['Parecer', (d) => d.parecer],
  ];
  const celula = (v) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [colunas.map((c) => c[0]).join(';'), ...banco.devolucoes.map((d) => colunas.map((c) => celula(c[1](d))).join(';'))];
  baixarArquivo(`devolucoes-${hojeISO()}.csv`, '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ============================ 10. INICIALIZAÇÃO ========================== */

function iniciar() {
  carregar();
  preencherSelects();

  window.addEventListener('hashchange', navegar);
  $('painelMes').addEventListener('change', renderPainel);
  ['filtroBusca', 'filtroStatus', 'filtroTipo', 'filtroCanal'].forEach((id) => $(id).addEventListener('input', renderLista));
  $('btnLimparFiltros').addEventListener('click', () => {
    ['filtroBusca', 'filtroStatus', 'filtroTipo', 'filtroCanal'].forEach((id) => ($(id).value = ''));
    renderLista();
  });

  $('formNova').addEventListener('submit', salvarNova);
  $('formNova').addEventListener('reset', () => setTimeout(atualizarAvisoPrazo, 0));
  $('entrega').addEventListener('change', atualizarAvisoPrazo);
  $('tipo').addEventListener('change', atualizarAvisoPrazo);
  $('entrega').max = hojeISO();

  $('formAvancar').addEventListener('submit', avancarEtapa);
  $('formInspecao').addEventListener('submit', concluirInspecao);
  $('btnRecusar').addEventListener('click', recusar);
  $('btnRecusarInicio').addEventListener('click', recusar);
  $('btnExcluir').addEventListener('click', excluir);

  $('btnBackup').addEventListener('click', fazerBackup);
  $('arquivoRestaurar').addEventListener('change', restaurarBackup);
  $('btnExportarCsv').addEventListener('click', exportarCsv);

  navegar();
}

iniciar();
