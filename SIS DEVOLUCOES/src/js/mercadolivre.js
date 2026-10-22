/* =========================================================================
   MERCADOLIVRE.JS — integração com o Mercado Livre pela ponte (ponte/worker.js).
   O sistema nunca fala direto com o ML: o segredo do app e os tokens ficam na
   ponte. Plano completo em docs/integracao-mercadolivre.md.

   Funções puras (testáveis sem internet): converterDevolucaoML, moverParaEtapaML,
   montarRevisaoML. As que chamam a ponte: sincronizarML, atualizarDoML,
   enviarRevisaoML, carregarMotivosML.
   ========================================================================= */
'use strict';

let sincronizandoML = false;
let ultimoErroML = '';

/* ---------------------------- Configuração ---------------------------- */

function configML() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CONFIG_ML)) || {};
  } catch {
    return {};
  }
}

function salvarConfigML(cfg) {
  try {
    localStorage.setItem(CHAVE_CONFIG_ML, JSON.stringify(cfg));
    return true;
  } catch (erro) {
    console.error(erro);
    return false;
  }
}

function mlConfigurado() {
  const cfg = configML();
  return !!(cfg.url && cfg.chave);
}

/* ------------------------------- Ponte ------------------------------- */

async function chamarPonte(caminho, { method = 'GET', body, headers = {}, tempoLimite = 30000 } = {}) {
  const cfg = configML();
  if (!cfg.url || !cfg.chave)
    throw new Error('Configure a ponte do Mercado Livre em Dados → Mercado Livre.');
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoLimite);
  let resposta;
  try {
    resposta = await fetch(cfg.url.replace(/\/+$/, '') + caminho, {
      method,
      body,
      headers: { 'X-Chave-Ponte': cfg.chave, ...headers },
      signal: controle.signal,
    });
  } catch (erro) {
    throw new Error(
      erro.name === 'AbortError'
        ? 'A ponte do Mercado Livre demorou demais para responder.'
        : 'Sem conexão com a ponte do Mercado Livre (confira a internet e o endereço).',
    );
  } finally {
    clearTimeout(timer);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `A ponte respondeu com erro ${resposta.status}.`);
  return dados;
}

/* ------------------------ Conversão (funções puras) ------------------------ */

/** Data/hora ISO do ML → AAAA-MM-DD no fuso do computador. */
function dataLocalDeISO(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : hojeISO(d);
}

/** Transforma o pacote da ponte (claim, devolucao, pedido, envio, custo, detalhe) em campos do sistema. */
function converterDevolucaoML(pacote) {
  const { claim = {}, devolucao = {}, pedido = null, envio = null, custo = null, detalhe = null } = pacote || {};
  if (!claim.id || !devolucao.id) throw new Error('Pacote do Mercado Livre sem reclamação ou devolução.');

  const itemDev = devolucao.orders?.[0] || {};
  const itensPedido = pedido?.order_items || [];
  const itemPed = itensPedido.find((i) => i.item?.id === itemDev.item_id) || itensPedido[0] || null;
  const quantidade = Number(itemDev.return_quantity || itemPed?.quantity || claim.claimed_quantity || 1);
  const comprador = pedido?.buyer || {};
  const nome =
    [comprador.first_name, comprador.last_name].filter(Boolean).join(' ') ||
    comprador.nickname ||
    'Comprador Mercado Livre';
  const envioDev = (devolucao.shipments || []).find((s) => s.type === 'return') || devolucao.shipments?.[0] || {};
  const vendedor = (claim.players || []).find((p) => p.type === 'seller') || {};
  const acoesRevisao = (vendedor.available_actions || []).filter((a) => String(a.action).startsWith('return_review'));
  const reason = String(claim.reason_id || '');

  return {
    campos: {
      abertura: dataLocalDeISO(devolucao.date_created || claim.date_created) || hojeISO(),
      pedido: String(itemDev.order_id || pedido?.id || claim.resource_id || ''),
      canal: 'mercadolivre',
      entrega:
        dataLocalDeISO(envio?.status_history?.date_delivered) ||
        dataLocalDeISO(pedido?.date_closed) ||
        dataLocalDeISO(claim.date_created) ||
        hojeISO(),
      nfVenda: '',
      valorProduto: Math.round(Number(itemPed?.unit_price || 0) * quantidade * 100) / 100,
      frete: Number(custo?.amount || 0),
      cliente: nome,
      cpf: '',
      contato: comprador.nickname ? `ML: ${comprador.nickname}` : '',
      produto:
        [itemPed?.item?.seller_sku, itemPed?.item?.title].filter(Boolean).join(' · ') || String(itemDev.item_id || ''),
      quantidade,
      tipo: claim.type === 'change' ? 'troca' : reason.startsWith('PDD') ? 'defeito' : 'arrependimento',
      motivo: reason.startsWith('PDD') ? 'defeito' : 'outro',
      solucao: claim.type === 'change' ? 'troca' : 'reembolso',
      observacao: detalhe?.problem || '',
    },
    rastreio: envioDev.tracking_number || '',
    etapa: MAPA_STATUS_ML[devolucao.status] || 'solicitada',
    ml: {
      claimId: String(claim.id),
      returnId: String(devolucao.id),
      orderId: String(itemDev.order_id || pedido?.id || ''),
      itemId: itemDev.item_id || '',
      packId: pedido?.pack_id ? String(pedido.pack_id) : '',
      statusDevolucao: devolucao.status || '',
      statusDinheiro: devolucao.status_money || '',
      reembolsoEm: devolucao.refund_at || '',
      destino: envioDev.destination?.name || '',
      // Indo para o depósito do ML, a revisão é da triagem do ML, não do vendedor.
      triagem: envioDev.destination?.name === 'warehouse',
      podeRevisar: acoesRevisao.length > 0,
      prazoRevisao: acoesRevisao.map((a) => a.due_date).filter(Boolean).sort()[0] || detalhe?.due_date || '',
      situacaoTexto: [detalhe?.title, detalhe?.description].filter(Boolean).join(' — '),
      claimAtualizadoEm: claim.last_updated || '',
      sincronizadoEm: new Date().toISOString(),
    },
  };
}

/** Avança a devolução até a etapa informada pelo ML (nunca volta). Encerradas não mudam. */
function moverParaEtapaML(d, etapa) {
  if (!ABERTAS.includes(d.status) || !etapa || etapa === d.status) return false;
  if (etapa === 'cancelada') {
    d.parecer = d.parecer || 'Devolução cancelada, expirada ou não entregue no Mercado Livre.';
    registrarEtapa(d, 'cancelada', 'via Mercado Livre');
    return true;
  }
  const atual = ETAPAS.indexOf(d.status);
  const alvo = ETAPAS.indexOf(etapa);
  if (alvo <= atual) return false;
  for (let i = atual + 1; i <= alvo; i++) registrarEtapa(d, ETAPAS[i], 'via Mercado Livre');
  return true;
}

/** Cria ou atualiza a devolução a partir do pacote. Nunca apaga o que a equipe preencheu. */
function aplicarPacoteML(pacote) {
  const conv = converterDevolucaoML(pacote);
  let d = banco.devolucoes.find((x) => x.ml?.claimId === conv.ml.claimId);
  const nova = !d;
  if (nova) {
    d = criarDevolucao({
      ...conv.campos,
      origem: 'mercadolivre',
      ml: { ...conv.ml, revisao: { situacao: 'nao_aplica', tentativas: 0, anexos: [] } },
    });
  } else {
    d.ml = { ...d.ml, ...conv.ml, revisao: d.ml.revisao };
    if (!d.frete && conv.campos.frete) d.frete = conv.campos.frete;
  }
  if (conv.rastreio && !d.rastreio) d.rastreio = conv.rastreio;
  moverParaEtapaML(d, conv.etapa);
  return nova ? 'nova' : 'atualizada';
}

/** A revisão desta devolução é feita pelo vendedor no ML? */
function revisaoMLAplicavel(d) {
  return d.origem === 'mercadolivre' && !!d.ml && !d.ml.triagem;
}

/** Corpo do POST return-review. {} = chegou OK; lista = chegou com problema. Lança Error se faltar algo. */
function montarRevisaoML(d, { resultado, motivo, mensagem, anexos = [] }) {
  if (resultado === 'ok') return {};
  if (resultado !== 'falha') throw new Error('Escolha o resultado para o Mercado Livre.');
  if (!motivo) throw new Error('Escolha o motivo do problema para o Mercado Livre.');
  const texto = String(mensagem || '').trim();
  if (!texto) throw new Error('Escreva o parecer da inspeção: ele é a mensagem enviada ao Mercado Livre.');
  if (MOTIVOS_ML_COM_ANEXO.includes(motivo) && !anexos.length)
    throw new Error('Para este motivo o Mercado Livre exige foto ou arquivo de evidência.');
  return [{ reason: motivo, message: texto, ...(anexos.length ? { attachments: anexos } : {}) }];
}

/* ------------------------ Chamadas (usam a ponte) ------------------------ */

/** Busca na ponte as devoluções novas ou alteradas e aplica no banco. */
async function sincronizarML({ silencioso = false } = {}) {
  if (sincronizandoML) return null;
  sincronizandoML = true;
  atualizarBotaoML();
  try {
    const cfg = configML();
    const desde = cfg.ultimaSincronizacao
      ? somarDias(dataLocalDeISO(cfg.ultimaSincronizacao), -1)
      : somarDias(hojeISO(), -ML_DIAS_PRIMEIRA_SINCRONIZACAO);
    const { devolucoes = [] } = await chamarPonte(`/devolucoes?desde=${desde}`);
    const contagem = { novas: 0, atualizadas: 0, erros: 0 };
    for (const item of devolucoes) {
      const existente = banco.devolucoes.find((d) => d.ml?.claimId === String(item.claimId));
      if (existente && item.atualizadoEm && existente.ml.claimAtualizadoEm === item.atualizadoEm) continue;
      try {
        const resultado = aplicarPacoteML(await chamarPonte(`/devolucoes/${item.claimId}`));
        contagem[resultado === 'nova' ? 'novas' : 'atualizadas']++;
      } catch (erro) {
        console.error(erro);
        contagem.erros++;
      }
    }
    salvar();
    salvarConfigML({ ...configML(), ultimaSincronizacao: new Date().toISOString() });
    ultimoErroML = '';
    if (!silencioso || contagem.novas || contagem.erros)
      toast(
        `Mercado Livre: ${contagem.novas} nova(s), ${contagem.atualizadas} atualizada(s)` +
          (contagem.erros ? `, ${contagem.erros} com erro` : '') +
          '.',
      );
    redesenharListagens();
    return contagem;
  } catch (erro) {
    ultimoErroML = erro.message;
    if (!silencioso) alert(erro.message);
    return null;
  } finally {
    sincronizandoML = false;
    atualizarBotaoML();
  }
}

/** Atualiza uma devolução do ML agora (botão no detalhe). */
async function atualizarDoML(d) {
  aplicarPacoteML(await chamarPonte(`/devolucoes/${d.ml.claimId}`));
  salvar();
}

/** Envia evidências (se houver) e a revisão. Grava a situação; retorna true se o ML aceitou. */
async function enviarRevisaoML(d, arquivos = []) {
  const r = d.ml.revisao;
  r.situacao = 'enviando';
  r.tentativas = (r.tentativas || 0) + 1;
  try {
    if (r.tipo === 'falha' && arquivos.length) {
      const nomes = [];
      for (const arquivo of arquivos) {
        const { fileName } = await chamarPonte(`/anexos/${d.ml.claimId}`, {
          method: 'POST',
          body: arquivo,
          headers: {
            'Content-Type': arquivo.type || 'application/octet-stream',
            'X-Nome-Arquivo': String(arquivo.name || 'evidencia').replace(/[^\w.-]+/g, '_'),
          },
          tempoLimite: 60000,
        });
        nomes.push(fileName);
      }
      r.anexos = nomes;
    }
    const corpo = montarRevisaoML(d, {
      resultado: r.tipo,
      motivo: r.motivo,
      mensagem: d.parecer,
      anexos: r.anexos || [],
    });
    await chamarPonte(`/revisao/${d.ml.returnId}?claimId=${d.ml.claimId}`, {
      method: 'POST',
      body: JSON.stringify(corpo),
      headers: { 'Content-Type': 'application/json' },
    });
    r.situacao = 'enviada';
    r.enviadaEm = new Date().toISOString();
    r.ultimoErro = '';
  } catch (erro) {
    r.situacao = 'erro';
    r.ultimoErro = erro.message;
  }
  salvar();
  return r.situacao === 'enviada';
}

/** Troca as opções do select de motivos pela lista oficial da ponte (mantém a reserva se falhar). */
async function carregarMotivosML(d, select) {
  try {
    const { motivos = [] } = await chamarPonte(`/motivos-falha?claimId=${d.ml.claimId}`);
    if (!motivos.length) return;
    const atual = select.value;
    select.innerHTML = motivos
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((m) => `<option value="${esc(m.id)}">${esc(m.detail || m.name || m.id)}</option>`)
      .join('');
    if ([...select.options].some((o) => o.value === atual)) select.value = atual;
  } catch (erro) {
    console.warn('Motivos do ML indisponíveis, usando a lista de reserva.', erro);
  }
}

/* ------------------------------- Tela ------------------------------- */

function atualizarBotaoML() {
  const botao = $('btnSincronizarML');
  if (!botao) return;
  const cfg = configML();
  botao.classList.toggle('botao-ml--girando', sincronizandoML);
  botao.classList.toggle('botao-ml--erro', !!ultimoErroML);
  botao.title = !mlConfigurado()
    ? 'Mercado Livre não configurado'
    : ultimoErroML
      ? `Erro na última sincronização: ${ultimoErroML}`
      : cfg.ultimaSincronizacao
        ? `Última sincronização: ${dataHoraBR(cfg.ultimaSincronizacao)}`
        : 'Ainda não sincronizado';
}

/** Redesenha painel/lista após sincronizar (não mexe no detalhe para não perder o que está sendo digitado). */
function redesenharListagens() {
  const tela = (location.hash.slice(1) || 'painel').split('/')[0];
  if (tela === 'painel') renderPainel();
  if (tela === 'lista') renderLista();
}

function cliqueSincronizarML() {
  if (!mlConfigurado()) {
    location.hash = '#config';
    return;
  }
  sincronizarML();
}

/** Primeira sincronização logo após abrir e depois a cada ML_INTERVALO_SINCRONIZACAO_MIN. */
function iniciarSincronizacaoAutomaticaML() {
  atualizarBotaoML();
  if (!mlConfigurado()) return;
  setTimeout(() => sincronizarML({ silencioso: true }), 3000);
  setInterval(() => mlConfigurado() && sincronizarML({ silencioso: true }), ML_INTERVALO_SINCRONIZACAO_MIN * 60000);
}
