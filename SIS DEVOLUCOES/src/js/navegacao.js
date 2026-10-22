/* =========================================================================
   NAVEGACAO.JS — troca de telas pelo endereço (#painel, #lista, #nova,
   #detalhe/DV-0001). As funções render* ficam nos arquivos de cada tela.
   ========================================================================= */
'use strict';

const TELAS = ['painel', 'lista', 'nova', 'detalhe', 'config'];

function navegar() {
  const [tela, codigo] = (location.hash.slice(1) || 'painel').split('/');
  const nomeTela = TELAS.includes(tela) ? tela : 'painel';

  document
    .querySelectorAll('.tela')
    .forEach((s) => s.classList.toggle('tela--ativa', s.id === `tela-${nomeTela}`));
  const menuAtivo = nomeTela === 'detalhe' ? 'lista' : nomeTela;
  document
    .querySelectorAll('.abas__item')
    .forEach((a) => a.classList.toggle('abas__item--ativo', a.dataset.tela === menuAtivo));
  fecharMenuDados();

  if (nomeTela === 'painel') renderPainel();
  if (nomeTela === 'lista') renderLista();
  if (nomeTela === 'nova') prepararNova();
  if (nomeTela === 'detalhe') renderDetalhe(decodeURIComponent(codigo || ''));
  if (nomeTela === 'config') renderConfig();
  window.scrollTo(0, 0);
}

/** Fecha o menu "Dados" da barra superior (é um <details>). */
function fecharMenuDados() {
  document.querySelector('.menu-dados')?.removeAttribute('open');
}

/** Abre a lista já filtrada por um status (usado pelo funil do painel). */
function abrirListaPorStatus(status) {
  FILTROS_LISTA.forEach((id) => ($(id).value = ''));
  $('filtroStatus').value = status;
  if (location.hash === '#lista') renderLista();
  else location.hash = '#lista';
}
