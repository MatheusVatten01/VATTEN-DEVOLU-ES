/* =========================================================================
   LISTA.JS — tabela de devoluções com busca e filtros.
   ========================================================================= */
'use strict';

const FILTROS_LISTA = ['filtroBusca', 'filtroStatus', 'filtroTipo', 'filtroCanal', 'filtroOrigem'];

/** Selo "ML" ao lado do código; com alerta quando a revisão não chegou ao ML. */
function seloML(d) {
  if (d.origem !== 'mercadolivre') return '';
  const situacao = d.ml?.revisao?.situacao;
  const alerta = situacao === 'erro' || situacao === 'pendente';
  return ` <span class="selo-ml${alerta ? ' selo-ml--alerta' : ''}" title="${
    alerta ? 'Revisão ainda não enviada ao Mercado Livre' : 'Importada do Mercado Livre'
  }">ML${alerta ? ' !' : ''}</span>`;
}

function renderLista() {
  const busca = $('filtroBusca').value.trim().toLowerCase();
  const status = $('filtroStatus').value;
  const tipo = $('filtroTipo').value;
  const canal = $('filtroCanal').value;
  const origem = $('filtroOrigem').value;

  const lista = banco.devolucoes
    .filter((d) => !status || d.status === status)
    .filter((d) => !tipo || d.tipo === tipo)
    .filter((d) => !canal || d.canal === canal)
    .filter((d) => !origem || (d.origem || 'manual') === origem)
    .filter(
      (d) => !busca || `${d.codigo} ${d.pedido} ${d.cliente} ${d.produto}`.toLowerCase().includes(busca),
    )
    .sort((a, b) => b.codigo.localeCompare(a.codigo));

  $('listaCorpo').innerHTML = lista.length
    ? lista
        .map((d) => {
          const alerta = ABERTAS.includes(d.status) && diasRestantes(d) <= 1;
          return `
        <tr>
          <td><b>${esc(d.codigo)}</b>${seloML(d)}</td>
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
        })
        .join('')
    : `<tr><td colspan="10" class="vazio">${
        banco.devolucoes.length
          ? 'Nenhuma devolução encontrada com estes filtros.'
          : 'Nenhuma devolução registrada ainda.'
      }</td></tr>`;
}

function limparFiltros() {
  FILTROS_LISTA.forEach((id) => ($(id).value = ''));
  renderLista();
}
