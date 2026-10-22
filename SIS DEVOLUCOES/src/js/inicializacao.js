/* =========================================================================
   INICIALIZACAO.JS — liga os botões e inicia o sistema.
   SEMPRE o último script em index.html.
   ========================================================================= */
'use strict';

function iniciar() {
  carregar();
  preencherSelects();

  window.addEventListener('hashchange', navegar);
  $('painelMes').addEventListener('change', renderPainel);
  $('painelFunil').addEventListener('click', (e) => {
    const etapa = e.target.closest('[data-status]');
    if (etapa) abrirListaPorStatus(etapa.dataset.status);
  });
  // Só os botões: o <label> do restaurar precisa do menu aberto até escolher o arquivo.
  document.querySelectorAll('button.menu-dados__item').forEach((item) => item.addEventListener('click', fecharMenuDados));
  FILTROS_LISTA.forEach((id) => $(id).addEventListener('input', renderLista));
  $('btnLimparFiltros').addEventListener('click', limparFiltros);

  $('formNova').addEventListener('submit', salvarNova);
  $('formNova').addEventListener('reset', () => setTimeout(atualizarAvisoPrazo, 0));
  $('entrega').addEventListener('change', atualizarAvisoPrazo);
  $('tipo').addEventListener('change', atualizarAvisoPrazo);

  $('formAvancar').addEventListener('submit', avancarEtapa);
  $('formInspecao').addEventListener('submit', concluirInspecao);
  $('btnRecusar').addEventListener('click', recusar);
  $('btnRecusarInicio').addEventListener('click', recusar);
  $('btnExcluir').addEventListener('click', excluir);

  // Mercado Livre
  $('btnSincronizarML').addEventListener('click', cliqueSincronizarML);
  $('btnAtualizarML').addEventListener('click', atualizarAbertaDoML);
  $('btnReenviarML').addEventListener('click', reenviarRevisao);
  $('estado').addEventListener('change', sugerirResultadoML);
  $('resultadoML').addEventListener('change', atualizarCamposFalhaML);
  $('formConfig').addEventListener('submit', salvarConfigTela);
  $('btnTestarPonte').addEventListener('click', testarPonte);
  $('btnSincronizarAgora').addEventListener('click', () => gravarConfigTela() && sincronizarML().then(renderConfig));

  $('btnBackup').addEventListener('click', fazerBackup);
  $('arquivoRestaurar').addEventListener('change', restaurarBackup);
  $('btnExportarCsv').addEventListener('click', exportarCsv);

  navegar();
  iniciarSincronizacaoAutomaticaML();
}

iniciar();
