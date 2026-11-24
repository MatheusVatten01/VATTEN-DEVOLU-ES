/* =========================================================================
   DETALHE.JS — dados de uma devolução, linha do tempo e ações de cada etapa.
   As regras ficam em dados.js; aqui só se lê a tela e mostra o resultado.
   ========================================================================= */
'use strict';

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
  const item = (rotulo, valor, classe = '') =>
    `<div class="dados__item"><small>${rotulo}</small><b class="${classe}">${valor}</b></div>`;
  $('detDados').innerHTML = [
    item('Cliente', esc(d.cliente)),
    item('CPF / contato', esc([d.cpf, d.contato].filter(Boolean).join(' · ') || '—')),
    item('Produto', `${esc(d.produto)} (${esc(d.quantidade)} un.)`),
    item('Valor do produto', reais(d.valorProduto)),
    item('Tipo / motivo', `${esc(texto('tipos', d.tipo))} · ${esc(texto('motivos', d.motivo))}`),
    item('Solução desejada', esc(texto('solucoes', d.solucao))),
    item('Entrega', dataBR(d.entrega)),
    item(
      'Prazo',
      aberta ? textoPrazo(d) : dataBR(prazoDe(d)),
      aberta && diasRestantes(d) <= 1 ? 'prazo-alerta' : '',
    ),
    item('Abertura', dataBR(d.abertura)),
    item('Frete reverso', reais(d.frete)),
    item('Postagem / rastreio', esc(d.rastreio || '—')),
    item('NF-e de venda', esc(d.nfVenda || '—')),
    ...(d.observacao
      ? [
          `<div class="dados__item" style="grid-column:1/-1"><small>Observações</small><b>${esc(
            d.observacao,
          )}</b></div>`,
        ]
      : []),
  ].join('');

  renderLinhaTempo(d);

  renderBlocoML(d, item);

  // Mostra só o bloco que faz sentido para a etapa atual. Nas devoluções do ML quem avança as etapas é o ML.
  const doML = d.origem === 'mercadolivre';
  $('detBlocoAvancar').classList.toggle('oculto', !BOTAO_AVANCAR[d.status] || doML);
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
    prepararCamposRevisaoML(d);
  }
  if (!aberta) {
    $('detResolucao').innerHTML =
      d.status === 'recusada' || d.status === 'cancelada'
        ? item(d.status === 'recusada' ? 'Motivo da recusa' : 'Situação', esc(d.parecer || '—'))
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
  const etapas = ['recusada', 'cancelada'].includes(d.status) ? d.historico.map((h) => h.status) : ETAPAS;
  $('detLinhaTempo').innerHTML = etapas
    .map((st) => {
      const h = feitas[st];
      const classe = st === d.status ? 'linha-tempo__etapa--atual' : h ? 'linha-tempo__etapa--feita' : '';
      return `<li class="linha-tempo__etapa ${classe}">
      <b>${esc(texto('status', st))}</b>
      <small>${h ? dataHoraBR(h.em) + (h.nota ? ' · ' + esc(h.nota) : '') : '—'}</small>
    </li>`;
    })
    .join('');
}

/* ---------------------------- Mercado Livre ---------------------------- */

const TEXTO_STATUS_DINHEIRO = { retained: 'Retido', refunded: 'Devolvido ao comprador', available: 'Liberado' };
const TEXTO_DESTINO_ML = { seller_address: 'Endereço da Vatten', warehouse: 'Depósito do ML (triagem)' };

function renderBlocoML(d, item) {
  const doML = d.origem === 'mercadolivre' && d.ml;
  $('detBlocoML').classList.toggle('oculto', !doML);
  if (!doML) return;
  const ml = d.ml;
  const r = ml.revisao || { situacao: 'nao_aplica' };
  $('detMLSituacao').textContent = ml.situacaoTexto || 'As etapas desta devolução são atualizadas pelo Mercado Livre.';
  $('detMLDados').innerHTML = [
    item('Reclamação / devolução', `${esc(ml.claimId)} · ${esc(ml.returnId)}`),
    item(
      'SKU',
      ml.sku
        ? `${esc(ml.sku)}${nomeRealDoSku(ml.sku) ? '' : ' <small class="prazo-alerta">(não está na tabela de produtos)</small>'}`
        : '—',
    ),
    item('Título do anúncio no ML', esc(ml.tituloAnuncio || '—')),
    item('Status no ML', esc(ml.statusDevolucao || '—')),
    item('Dinheiro', esc(TEXTO_STATUS_DINHEIRO[ml.statusDinheiro] || ml.statusDinheiro || '—')),
    item('Destino', esc(TEXTO_DESTINO_ML[ml.destino] || ml.destino || '—')),
    item('Prazo da revisão', ml.prazoRevisao ? esc(dataHoraBR(ml.prazoRevisao)) : '—'),
    item('Atualizado do ML', esc(dataHoraBR(ml.sincronizadoEm))),
  ].join('');

  renderFotosML(d);

  const classe = { enviada: 'ok', erro: 'erro', pendente: 'erro', enviando: 'andamento' }[r.situacao] || '';
  $('detMLRevisao').className = `revisao-ml ${classe ? 'revisao-ml--' + classe : ''}`;
  $('detMLRevisao').innerHTML =
    r.situacao === 'nao_aplica'
      ? ml.triagem
        ? 'Revisão feita pela triagem do Mercado Livre.'
        : 'A revisão será enviada ao concluir a inspeção.'
      : `<b>Revisão: ${esc(texto('situacoesRevisaoML', r.situacao))}</b>` +
        (r.tipo ? ` · ${esc(texto('resultadosML', r.tipo))}${r.motivo ? ' (' + esc(texto('motivosML', r.motivo)) + ')' : ''}` : '') +
        (r.enviadaEm ? ` · ${esc(dataHoraBR(r.enviadaEm))}` : '') +
        (r.ultimoErro ? `<br><small>${esc(r.ultimoErro)}</small>` : '');

  const reenviar = ['erro', 'pendente'].includes(r.situacao);
  $('acoesReenvioML').classList.toggle('oculto', !reenviar);
  // Sem evidências já enviadas e o motivo exige: pede os arquivos de novo (não ficam salvos no navegador).
  const precisaArquivos = reenviar && MOTIVOS_ML_COM_ANEXO.includes(r.motivo) && !(r.anexos || []).length;
  $('campoReenvioAnexos').classList.toggle('oculto', !precisaArquivos);
}

/* ------------------- Fotos e anexos da reclamação (ML) ------------------- */

const QUEM_ENVIOU = { complainant: 'Comprador', respondent: 'Vatten', mediator: 'Mediador ML' };
// Fotos já baixadas nesta sessão (claimId/arquivo → blob URL). Não ficam salvas no navegador.
const cacheFotosML = new Map();
// Devoluções antigas (sem lista de anexos): busca no ML uma vez por sessão ao abrir o detalhe.
const anexosBuscadosML = new Set();

function ehImagem(a) {
  return /^image\//i.test(a.tipo) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(a.arquivo);
}

function renderFotosML(d) {
  const caixa = $('detMLFotos');
  const anexos = d.ml.anexos;
  if (anexos === undefined) {
    caixa.innerHTML = '<p class="bloco__dica">Buscando fotos no Mercado Livre…</p>';
    if (mlConfigurado() && !anexosBuscadosML.has(d.codigo)) {
      anexosBuscadosML.add(d.codigo);
      atualizarAbertaDoML({ silencioso: true });
    } else caixa.innerHTML = '<p class="bloco__dica">Clique em "Atualizar do ML" para buscar as fotos.</p>';
    return;
  }
  if (d.ml.anexosErro && !anexos.length) {
    caixa.innerHTML = `<p class="aviso aviso--alerta">Não foi possível ler as mensagens da reclamação: ${esc(
      d.ml.anexosErro,
    )}. Confira se o aplicativo do ML tem a permissão "Comunicações pré e pós-vendas".</p>`;
    return;
  }
  if (!anexos.length) {
    caixa.innerHTML = '<p class="bloco__dica">Nenhuma foto ou anexo enviado na reclamação.</p>';
    return;
  }
  // Comprador primeiro, depois mediador do ML, por último os enviados pela Vatten.
  const ordem = { complainant: 0, mediator: 1 };
  const ordenados = anexos.slice().sort((a, b) => (ordem[a.de] ?? 2) - (ordem[b.de] ?? 2));
  caixa.innerHTML = ordenados
    .map((a, i) => {
      const legenda = `${QUEM_ENVIOU[a.de] || 'Enviado'} · ${dataHoraBR(a.data)}`;
      return ehImagem(a)
        ? `<button class="foto-ml" type="button" data-i="${i}" title="${esc(a.mensagem || a.nomeOriginal)}">
             <span class="foto-ml__img">Carregando…</span><small>${esc(legenda)}</small></button>`
        : `<button class="foto-ml foto-ml--arquivo" type="button" data-i="${i}" title="${esc(a.mensagem || '')}">
             <span class="foto-ml__img">📄 ${esc(a.nomeOriginal)}</span><small>${esc(legenda)}</small></button>`;
    })
    .join('');
  caixa._anexos = ordenados;
  caixa._claimId = d.ml.claimId;
  ordenados.forEach((a, i) => {
    if (ehImagem(a)) carregarFotoML(d.ml.claimId, a, caixa.querySelector(`[data-i="${i}"] .foto-ml__img`));
  });
}

async function urlDoAnexoML(claimId, a) {
  const chave = `${claimId}/${a.arquivo}`;
  if (!cacheFotosML.has(chave)) {
    const blob = await chamarPonteArquivo(`/foto/${encodeURIComponent(claimId)}/${encodeURIComponent(a.arquivo)}`);
    cacheFotosML.set(chave, URL.createObjectURL(blob));
  }
  return cacheFotosML.get(chave);
}

async function carregarFotoML(claimId, a, alvo) {
  try {
    const url = await urlDoAnexoML(claimId, a);
    if (!alvo.isConnected) return; // usuário já trocou de tela
    const img = document.createElement('img');
    img.src = url;
    img.alt = a.nomeOriginal || '';
    alvo.replaceChildren(img);
  } catch (erro) {
    if (alvo.isConnected) alvo.textContent = `Não carregou: ${erro.message}`;
  }
}

/** Clique numa miniatura: foto abre no visor; PDF/outro abre numa aba nova. */
async function abrirAnexoML(evento) {
  const botao = evento.target.closest('.foto-ml');
  if (!botao) return;
  const caixa = $('detMLFotos');
  const a = caixa._anexos?.[Number(botao.dataset.i)];
  if (!a) return;
  try {
    const url = await urlDoAnexoML(caixa._claimId, a);
    if (ehImagem(a)) {
      $('visorImagem').src = url;
      $('visorLegenda').textContent = [QUEM_ENVIOU[a.de], dataHoraBR(a.data), a.mensagem].filter(Boolean).join(' · ');
      $('visorFoto').classList.remove('oculto');
    } else window.open(url, '_blank', 'noopener');
  } catch (erro) {
    alert(erro.message);
  }
}

function fecharVisorFoto() {
  $('visorFoto').classList.add('oculto');
  $('visorImagem').removeAttribute('src');
}

/** Mostra/esconde os campos de revisão do ML na inspeção e sugere o resultado pelo estado do produto. */
function prepararCamposRevisaoML(d) {
  const revisar = revisaoMLAplicavel(d);
  $('camposML').classList.toggle('oculto', !revisar);
  $('avisoTriagemML').classList.toggle('oculto', !(d.origem === 'mercadolivre' && d.ml?.triagem));
  if (!revisar) return;
  $('dicaRevisaoML').textContent = d.ml.podeRevisar
    ? 'Ao concluir, a revisão é enviada à conta do Mercado Livre. O parecer acima vai como mensagem.'
    : 'Atenção: na última atualização o ML não mostrava a revisão disponível (prazo pode ter vencido). O envio será tentado mesmo assim.';
  sugerirResultadoML();
  carregarMotivosML(d, $('motivoML'));
}

function sugerirResultadoML() {
  $('resultadoML').value = $('estado').value === 'A' ? 'ok' : 'falha';
  atualizarCamposFalhaML();
}

function atualizarCamposFalhaML() {
  const falha = $('resultadoML').value === 'falha';
  $('campoMotivoML').classList.toggle('oculto', !falha);
  $('campoAnexosML').classList.toggle('oculto', !falha);
}

async function atualizarAbertaDoML({ silencioso = false } = {}) {
  const d = buscar(codigoAberto);
  if (!d?.ml) return;
  try {
    await atualizarDoML(d);
    if (!silencioso) toast(`${d.codigo} atualizada do Mercado Livre.`);
  } catch (erro) {
    if (!silencioso) alert(erro.message);
    // Sem conseguir buscar: deixa a lista vazia com o motivo, para não ficar "Buscando…" para sempre.
    if (d.ml.anexos === undefined) {
      d.ml.anexos = [];
      d.ml.anexosErro = erro.message;
    }
  }
  if (codigoAberto !== d.codigo || !location.hash.startsWith('#detalhe/')) return;
  // Busca automática: redesenha só as fotos, para não apagar o que está sendo digitado na inspeção.
  if (silencioso) renderFotosML(d);
  else renderDetalhe(d.codigo);
}

/** Envia a revisão e avisa o resultado; redesenha se a devolução ainda estiver aberta na tela. */
async function enviarRevisaoComAviso(d, arquivos) {
  const ok = await enviarRevisaoML(d, arquivos);
  toast(ok ? `${d.codigo}: revisão enviada ao Mercado Livre.` : `${d.codigo}: o ML não recebeu a revisão — ${d.ml.revisao.ultimoErro}`);
  if (codigoAberto === d.codigo && location.hash.startsWith('#detalhe/')) renderDetalhe(d.codigo);
  return ok;
}

function reenviarRevisao() {
  const d = buscar(codigoAberto);
  if (!d?.ml?.revisao) return;
  const arquivos = [...$('anexosReenvioML').files];
  try {
    montarRevisaoML(d, {
      resultado: d.ml.revisao.tipo,
      motivo: d.ml.revisao.motivo,
      mensagem: d.parecer,
      anexos: (d.ml.revisao.anexos || []).length ? d.ml.revisao.anexos : arquivos.map((f) => f.name),
    });
  } catch (erro) {
    alert(erro.message);
    return;
  }
  $('anexosReenvioML').value = '';
  enviarRevisaoComAviso(d, arquivos);
  renderDetalhe(d.codigo);
}

/** Executa uma regra sobre a devolução aberta e redesenha a tela; erros viram alerta. */
function acaoNaAberta(regra, mensagem) {
  const d = buscar(codigoAberto);
  if (!d) return;
  try {
    regra(d);
  } catch (erro) {
    alert(erro.message);
    return;
  }
  toast(mensagem(d));
  renderDetalhe(d.codigo);
}

function avancarEtapa(evento) {
  evento.preventDefault();
  acaoNaAberta(
    (d) => avancar(d, $('rastreio').value),
    (d) => `${d.codigo}: ${texto('status', d.status)}.`,
  );
}

function concluirInspecao(evento) {
  evento.preventDefault();
  const form = evento.target;
  const d = buscar(codigoAberto);
  if (!d) return;
  const campos = Object.fromEntries(new FormData(form));
  const arquivos = [...$('anexosML').files];
  const revisar = revisaoMLAplicavel(d);
  if (revisar) {
    const motivo = campos.resultadoML === 'falha' ? campos.motivoML : '';
    // Valida antes de concluir: se faltar algo para o ML, nada é gravado.
    try {
      montarRevisaoML(d, {
        resultado: campos.resultadoML,
        motivo,
        mensagem: campos.parecer,
        anexos: arquivos.map((f) => f.name),
      });
    } catch (erro) {
      alert(erro.message);
      return;
    }
    campos.revisaoML = { tipo: campos.resultadoML, motivo, anexos: [], ultimoErro: '' };
  }
  acaoNaAberta(
    (aberta) => {
      concluir(aberta, campos);
      form.reset();
      $('anexosML').value = '';
    },
    (aberta) => `${aberta.codigo} concluída.${revisar ? ' Enviando revisão ao Mercado Livre…' : ''}`,
  );
  // Conclusão já está salva; o envio ao ML vem depois e, se falhar, fica pendente com botão Reenviar.
  if (revisar && d.status === 'concluida') enviarRevisaoComAviso(d, arquivos);
}

function recusar() {
  const motivo = prompt('Motivo da recusa (obrigatório):');
  if (motivo === null) return;
  acaoNaAberta(
    (d) => recusarDevolucao(d, motivo),
    (d) => `${d.codigo} recusada.`,
  );
}

function excluir() {
  const d = buscar(codigoAberto);
  if (!d || !confirm(`Excluir definitivamente a devolução ${d.codigo}? Esta ação não pode ser desfeita.`))
    return;
  excluirDevolucao(d.codigo);
  toast(`${d.codigo} excluída.`);
  location.hash = '#lista';
}
